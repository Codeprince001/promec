import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, UserType } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { ApiException } from '../../common/api.exception';
import { FieldCipher } from '../../common/crypto/field-cipher.service';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RateLimitService } from '../../infra/rate-limit.service';
import { RbacService } from '../rbac/rbac.service';
import type { LoginInput, MfaInput, RegisterInput } from './auth.schemas';
import { hashPassword, verifyPassword } from './password';
import { decodeBase32, generateTotpSecret, otpauthUrl, verifyTotp } from './totp';

type RequestContext = { ip?: string; userAgent?: string };

@Injectable()
export class AuthService {
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly rbac: RbacService,
    private readonly config: ConfigService,
    private readonly rateLimit: RateLimitService,
    private readonly cipher: FieldCipher,
    private readonly notifications: NotificationsService,
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
    if (email) await this.sendEmailVerification(user.id, email);
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
    if (user.mfaEnabled) {
      const enrolled = Boolean(user.totpSecretEnc && user.totpConfirmedAt);
      const pendingSecret = enrolled ? null : generateTotpSecret();
      const challenge = await this.prisma.mfaChallenge.create({
        data: {
          userId: user.id,
          codeHash: 'totp',
          purpose: enrolled ? 'verify' : 'enroll',
          pendingSecretEnc: pendingSecret ? this.cipher.encrypt(pendingSecret) : undefined,
          expiresAt: new Date(Date.now() + 10 * 60_000),
        },
      });
      const account = user.email ?? user.phone ?? user.id;
      return {
        mfaRequired: true as const,
        enrollmentRequired: !enrolled,
        challengeId: challenge.id,
        ...(pendingSecret ? { secret: pendingSecret, otpauthUrl: otpauthUrl(account, pendingSecret) } : {}),
      };
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return this.issueTokens(user.id, user.userType, randomUUID(), ctx);
  }

  async verifyMfa(input: MfaInput, ctx: RequestContext) {
    this.rateLimit.consume(`mfa:${input.challengeId}`, 5, 10 * 60_000);
    const challenge = await this.prisma.mfaChallenge.findUnique({ where: { id: input.challengeId }, include: { user: true } });
    if (!challenge || challenge.consumedAt || challenge.expiresAt < new Date()) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, 'INVALID_CODE', 'That code is not valid');
    }
    const secretEnc = challenge.purpose === 'enroll' ? challenge.pendingSecretEnc : challenge.user.totpSecretEnc;
    if (!secretEnc) throw new ApiException(HttpStatus.UNAUTHORIZED, 'INVALID_CODE', 'That code is not valid');
    let step: number | null = null;
    try {
      step = verifyTotp(decodeBase32(this.cipher.decrypt(secretEnc)), input.code, challenge.purpose === 'enroll' ? null : challenge.user.totpLastStep);
    } catch {
      step = null;
    }
    if (step == null) throw new ApiException(HttpStatus.UNAUTHORIZED, 'INVALID_CODE', 'That code is not valid');
    const acceptedStep = step;
    const recoveryCodes = await this.prisma.$transaction(async (tx) => {
      await tx.mfaChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
      await tx.user.update({
        where: { id: challenge.userId },
        data: {
          lastLoginAt: new Date(),
          totpLastStep: acceptedStep,
          ...(challenge.purpose === 'enroll'
            ? { totpSecretEnc: secretEnc, totpConfirmedAt: new Date(), mfaEnabled: true }
            : {}),
        },
      });
      return challenge.purpose === 'enroll' ? this.storeRecoveryCodes(tx, challenge.userId) : undefined;
    });
    const tokens = await this.issueTokens(challenge.user.id, challenge.user.userType, randomUUID(), ctx);
    return recoveryCodes ? { ...tokens, recoveryCodes } : tokens;
  }

  async recoverMfa(challengeId: string, code: string, ctx: RequestContext) {
    this.rateLimit.consume(`mfa:${challengeId}`, 5, 10 * 60_000);
    const challenge = await this.prisma.mfaChallenge.findUnique({ where: { id: challengeId }, include: { user: true } });
    if (!challenge || challenge.consumedAt || challenge.expiresAt < new Date()) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, 'INVALID_CODE', 'That code is not valid');
    }
    const recovery = await this.prisma.recoveryCode.findUnique({ where: { codeHash: sha256(code.trim().toUpperCase()) } });
    if (!recovery || recovery.usedAt || recovery.userId !== challenge.userId) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, 'INVALID_CODE', 'That recovery code is not valid');
    }
    await this.prisma.$transaction([
      this.prisma.recoveryCode.update({ where: { id: recovery.id }, data: { usedAt: new Date() } }),
      this.prisma.mfaChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } }),
    ]);
    return this.issueTokens(challenge.user.id, challenge.user.userType, randomUUID(), ctx);
  }

  async sendPasswordResetFor(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.email || user.deletedAt) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'User was not found');
    return this.requestPasswordReset(user.email);
  }

  async requestPasswordReset(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (user?.email && !user.deletedAt) {
      const raw = randomBytes(32).toString('hex');
      await this.prisma.authToken.create({
        data: { userId: user.id, purpose: 'password_reset', tokenHash: sha256(raw), expiresAt: new Date(Date.now() + 30 * 60_000) },
      });
      await this.notifications.enqueue({
        userId: user.id,
        to: user.email,
        channel: 'email',
        template: 'password.reset',
        payload: { url: `${this.config.get<string>('APP_URL')}/reset-password?token=${raw}` },
      });
    }
    return { sent: true };
  }

  async resetPassword(token: string, password: string) {
    const row = await this.consumeToken(token, 'password_reset');
    await this.prisma.user.update({ where: { id: row.userId }, data: { passwordHash: await hashPassword(password) } });
    await this.prisma.session.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    return { reset: true };
  }

  async sendEmailVerification(userId: string, email: string) {
    const raw = randomBytes(32).toString('hex');
    await this.prisma.authToken.create({
      data: { userId, purpose: 'email_verify', tokenHash: sha256(raw), expiresAt: new Date(Date.now() + 24 * 60 * 60_000) },
    });
    await this.notifications.enqueue({
      userId,
      to: email,
      channel: 'email',
      template: 'email.verify',
      payload: { url: `${this.config.get<string>('APP_URL')}/verify-email?token=${raw}` },
    });
    return { sent: true };
  }

  async verifyEmail(token: string) {
    const row = await this.consumeToken(token, 'email_verify');
    await this.prisma.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } });
    return { verified: true };
  }

  sessions(userId: string) {
    return this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, ip: true, userAgent: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeSession(userId: string, sessionId: string) {
    const result = await this.prisma.session.updateMany({ where: { id: sessionId, userId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!result.count) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Session was not found');
    return { revoked: true };
  }

  async clearMfa(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'User was not found');
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: false, totpSecretEnc: null, totpConfirmedAt: null, totpLastStep: null },
    });
    await this.prisma.recoveryCode.deleteMany({ where: { userId } });
    await this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    return { cleared: true };
  }

  async replaceRecoveryCodes(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.mfaEnabled) throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'This account has no authenticator to recover');
    return this.prisma.$transaction(async (tx) => {
      await tx.recoveryCode.deleteMany({ where: { userId } });
      return { recoveryCodes: await this.storeRecoveryCodes(tx, userId) };
    });
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
      mfaEnabled: user.mfaEnabled,
      totpEnrolled: Boolean(user.totpConfirmedAt),
      emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
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

  private async consumeToken(token: string, purpose: string) {
    const row = await this.prisma.authToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.purpose !== purpose || row.consumedAt || row.expiresAt < new Date()) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, 'INVALID_CODE', 'That link is not valid');
    }
    await this.prisma.authToken.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
    return row;
  }

  private async storeRecoveryCodes(tx: Prisma.TransactionClient, userId: string) {
    const codes = Array.from({ length: 8 }, () => randomBytes(5).toString('hex').toUpperCase());
    await tx.recoveryCode.createMany({ data: codes.map((code) => ({ userId, codeHash: sha256(code) })) });
    return codes;
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
