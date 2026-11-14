import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserType } from '@prisma/client';
import { createHash, randomBytes, randomInt, randomUUID } from 'crypto';
import { ApiException } from '../../common/api.exception';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { RateLimitService } from '../../infra/rate-limit.service';
import { RbacService } from '../rbac/rbac.service';
import type { LoginInput, MfaInput, RegisterInput } from './auth.schemas';
import { hashPassword, verifyPassword } from './password';

type RequestContext = { ip?: string; userAgent?: string };

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly rbac: RbacService,
    private readonly config: ConfigService,
    private readonly rateLimit: RateLimitService,
  ) {}

  async register(input: RegisterInput, ctx: RequestContext) {
    const email = input.email?.toLowerCase();
    const existing = await this.prisma.user.findFirst({
      where: { OR: [...(email ? [{ email }] : []), ...(input.phone ? [{ phone: input.phone }] : [])] },
    });
    if (existing) {
      throw new ApiException(HttpStatus.CONFLICT, 'ACCOUNT_EXISTS', 'An account with that email or phone already exists');
    }
    const passwordHash = await hashPassword(input.password);
    const user = await this.prisma.user.create({
      data: {
        email,
        phone: input.phone,
        passwordHash,
        userType: UserType.customer,
        customer: {
          create: {
            firstName: input.firstName,
            lastName: input.lastName,
            customerType: input.customerType,
            marketingConsent: input.marketingConsent,
          },
        },
      },
    });
    await this.rbac.ensureDefaults();
    await this.rbac.assignRole(user.id, 'customer');
    return this.issueTokens(user.id, user.userType, randomUUID(), ctx);
  }

  async login(input: LoginInput, ctx: RequestContext) {
    this.rateLimit.consume(`${ctx.ip ?? 'ip'}:${input.identifier.toLowerCase()}`, 10, 15 * 60_000);
    const identifier = input.identifier.toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ email: identifier }, { phone: input.identifier }], deletedAt: null },
    });
    const dummy = await this.getDummyHash();
    const matches = user ? await verifyPassword(user.passwordHash, input.password) : await verifyPassword(dummy, input.password).then(() => false);
    if (!user || !matches) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS', 'Email, phone or password is incorrect');
    }
    if (user.status !== 'active') {
      throw new ApiException(HttpStatus.FORBIDDEN, 'ACCOUNT_DISABLED', 'This account is disabled');
    }
    if (user.mfaEnabled || user.userType !== UserType.customer) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const challenge = await this.prisma.mfaChallenge.create({
        data: {
          userId: user.id,
          codeHash: sha256(code),
          expiresAt: new Date(Date.now() + 10 * 60_000),
        },
      });
      if (this.config.get('NODE_ENV') === 'development') {
        this.logger.warn(`MFA code for ${user.email ?? user.phone}: ${code}`);
      }
      return { mfaRequired: true as const, challengeId: challenge.id };
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return this.issueTokens(user.id, user.userType, randomUUID(), ctx);
  }

  async verifyMfa(input: MfaInput, ctx: RequestContext) {
    const challenge = await this.prisma.mfaChallenge.findUnique({ where: { id: input.challengeId }, include: { user: true } });
    if (!challenge || challenge.consumedAt) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, 'INVALID_CODE', 'That code is not valid');
    }
    if (challenge.expiresAt < new Date()) {
      throw new ApiException(HttpStatus.GONE, 'EXPIRED', 'That code has expired');
    }
    if (challenge.codeHash !== sha256(input.code)) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, 'INVALID_CODE', 'That code is not valid');
    }
    await this.prisma.mfaChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
    await this.prisma.user.update({ where: { id: challenge.userId }, data: { lastLoginAt: new Date() } });
    return this.issueTokens(challenge.user.id, challenge.user.userType, randomUUID(), ctx);
  }

  async refresh(rawToken: string | undefined, ctx: RequestContext) {
    if (!rawToken) throw new ApiException(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Refresh token missing');
    const session = await this.prisma.session.findFirst({
      where: { tokenHash: sha256(rawToken) },
      include: { user: true },
    });
    if (!session) throw new ApiException(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Refresh token is not valid');
    if (session.revokedAt) {
      await this.prisma.session.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new ApiException(HttpStatus.UNAUTHORIZED, 'REFRESH_REUSED', 'This session was revoked');
    }
    if (session.expiresAt < new Date()) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, 'REFRESH_EXPIRED', 'Refresh token has expired');
    }
    await this.prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    return this.issueTokens(session.user.id, session.user.userType, session.familyId, ctx);
  }

  async logout(rawToken: string | undefined) {
    if (!rawToken) return { loggedOut: true };
    await this.prisma.session.updateMany({
      where: { tokenHash: sha256(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { loggedOut: true };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { customer: true, roles: { include: { role: true } } },
    });
    if (!user) throw new ApiException(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Account no longer exists');
    const codes = await this.rbac.codesForUser(user.id);
    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      type: user.userType,
      status: user.status,
      roles: user.roles.map((row) => row.role.name),
      permissions: [...codes],
      customer: user.customer
        ? {
            id: user.customer.id,
            firstName: user.customer.firstName,
            lastName: user.customer.lastName,
            customerType: user.customer.customerType,
          }
        : null,
    };
  }

  private async issueTokens(userId: string, userType: UserType, familyId: string, ctx: RequestContext) {
    const refreshToken = randomBytes(48).toString('base64url');
    const days = this.config.get<number>('REFRESH_TOKEN_TTL_DAYS') ?? 30;
    await this.prisma.session.create({
      data: {
        userId,
        tokenHash: sha256(refreshToken),
        familyId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
      },
    });
    const accessToken = await this.jwt.signAsync({ sub: userId, type: userType } satisfies AuthUser);
    return { mfaRequired: false as const, accessToken, refreshToken };
  }

  private getDummyHash() {
    this.dummyHash ??= hashPassword('not-a-real-password');
    return this.dummyHash;
  }
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
