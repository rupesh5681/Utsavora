import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  AppAudience,
  LoginSchema,
  RegisterCustomerSchema,
  RegisterVendorSchema,
  type LoginInput,
  type RegisterCustomerInput,
  type RegisterVendorInput,
} from '@utsavora/validation';
import { Inject } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config';
import { ZodBody, ZodPipe } from '../common/zod';
import { AppError } from '../common/errors';
import { AuthThrottle } from '../common/throttle';
import { AuthService } from './auth.service';
import { APP_HEADER, cookieName, CurrentActor, Public, type Actor } from './actor';
import { HttpStatus } from '@nestjs/common';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  private audience(req: Request) {
    const r = AppAudience.safeParse(req.header(APP_HEADER));
    if (!r.success) throw new AppError(HttpStatus.BAD_REQUEST, 'MISSING_APP_HEADER', `The ${APP_HEADER} header is required.`);
    return r.data;
  }

  private ctx(req: Request) {
    return { ip: req.ip ?? null, userAgent: req.header('user-agent') ?? null };
  }

  private setCookie(res: Response, audience: AppAudience, token: string, expires: Date) {
    res.cookie(cookieName(audience), token, {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: 'lax',
      path: '/',
      expires,
    });
  }

  @Public()
  @AuthThrottle()
  @Post('register')
  @ZodBody(RegisterCustomerSchema)
  async register(@Body(new ZodPipe(RegisterCustomerSchema)) body: RegisterCustomerInput, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const s = await this.auth.registerCustomer(body, this.ctx(req));
    this.setCookie(res, 'customer', s.token, s.expiresAt);
    return { ok: true };
  }

  @Public()
  @AuthThrottle()
  @Post('register-vendor')
  @ZodBody(RegisterVendorSchema)
  async registerVendor(@Body(new ZodPipe(RegisterVendorSchema)) body: RegisterVendorInput, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const s = await this.auth.registerVendor(body, this.ctx(req));
    this.setCookie(res, 'vendor', s.token, s.expiresAt);
    return { ok: true };
  }

  @Public()
  @AuthThrottle()
  @HttpCode(200)
  @Post('login')
  @ZodBody(LoginSchema)
  async login(@Body(new ZodPipe(LoginSchema)) body: LoginInput, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const audience = this.audience(req);
    const s = await this.auth.login(body, audience, this.ctx(req));
    this.setCookie(res, audience, s.token, s.expiresAt);
    return { ok: true };
  }

  @HttpCode(200)
  @Post('logout')
  async logout(@CurrentActor() actor: Actor, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(actor.sessionId);
    res.clearCookie(cookieName(actor.audience), { path: '/' });
    return { ok: true };
  }

  @Get('me')
  me(@CurrentActor() actor: Actor) {
    return this.auth.me(actor);
  }
}
