import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { loginSchema, mfaSchema, registerSchema } from './auth.schemas';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('register')
  register(@Body({ schema: registerSchema }) body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.withCookie(this.auth.register(body as never, context(req)), res);
  }

  @Public()
  @HttpCode(200)
  @Post('login')
  login(@Body({ schema: loginSchema }) body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.withCookie(this.auth.login(body as never, context(req)), res);
  }

  @Public()
  @HttpCode(200)
  @Post('mfa/verify')
  verify(@Body({ schema: mfaSchema }) body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.withCookie(this.auth.verifyMfa(body as never, context(req)), res);
  }

  @Public()
  @HttpCode(200)
  @Post('refresh')
  refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.withCookie(this.auth.refresh(req.cookies?.refresh_token, context(req)), res);
  }

  @Public()
  @HttpCode(200)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.logout(req.cookies?.refresh_token);
    res.clearCookie('refresh_token', { path: '/api/v1/auth' });
    return result;
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.sub);
  }

  @Public()
  @HttpCode(200)
  @Post('password/forgot')
  forgot(@Body({ schema: z.object({ email: z.string().email() }) }) body: { email: string }) {
    return this.auth.requestPasswordReset(body.email);
  }

  @Public()
  @HttpCode(200)
  @Post('password/reset')
  reset(@Body({ schema: z.object({ token: z.string().min(20), password: z.string().min(8).max(128) }) }) body: { token: string; password: string }) {
    return this.auth.resetPassword(body.token, body.password);
  }

  @Public()
  @HttpCode(200)
  @Post('email/verify')
  verifyEmail(@Body({ schema: z.object({ token: z.string().min(20) }) }) body: { token: string }) {
    return this.auth.verifyEmail(body.token);
  }

  @HttpCode(200)
  @Post('email/send')
  sendEmail(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.sub).then((me) => {
      if (!me.email) return { sent: false };
      return this.auth.sendEmailVerification(user.sub, me.email);
    });
  }

  @Public()
  @HttpCode(200)
  @Post('mfa/recovery')
  recover(@Body({ schema: z.object({ challengeId: z.string().uuid(), code: z.string().min(8).max(32) }) }) body: { challengeId: string; code: string }, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.withCookie(this.auth.recoverMfa(body.challengeId, body.code, context(req)), res);
  }

  @Get('sessions')
  sessions(@CurrentUser() user: AuthUser) {
    return this.auth.sessions(user.sub);
  }

  @Delete('sessions/:id')
  revoke(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.auth.revokeSession(user.sub, id);
  }

  @Post('admin/users/:id/recovery-codes')
  @Permissions('users.manage')
  recoveryCodes(@Param('id') id: string) {
    return this.auth.replaceRecoveryCodes(id);
  }

  private async withCookie(pending: ReturnType<AuthService['login']>, res: Response) {
    const result = await pending;
    if ('refreshToken' in result && result.refreshToken) {
      const days = this.config.get<number>('REFRESH_TOKEN_TTL_DAYS') ?? 30;
      res.cookie('refresh_token', result.refreshToken, {
        httpOnly: true,
        secure: this.config.get('NODE_ENV') === 'production',
        sameSite: 'lax',
        path: '/api/v1/auth',
        maxAge: days * 24 * 60 * 60 * 1000,
      });
      const { refreshToken: _hidden, ...safe } = result;
      return safe;
    }
    return result;
  }
}

function context(req: Request) {
  return { ip: req.ip, userAgent: req.header('user-agent') ?? undefined };
}
