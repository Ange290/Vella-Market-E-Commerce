import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { REFRESH_COOKIE, clearRefreshCookie, setRefreshCookie } from './cookie';
import {
  ForgotPasswordDto,
  LoginDto,
  LoginOtpRequestDto,
  LoginOtpVerifyDto,
  RegisterDto,
  ResendOtpDto,
  ResetPasswordDto,
  VerifyOtpDto,
} from './dto/auth.dto';
import type { ClientContext } from './token.service';

const strict = { default: { limit: 5, ttl: 60_000 } };
const moderate = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('Auth')
@Public()
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @Throttle(strict)
  @ApiOperation({ summary: 'Create an account and email a 6-digit verification code' })
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.auth.register(dto, this.ctx(req));
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle(strict)
  @ApiOperation({ summary: 'Verify the registration OTP; activates the account and signs the user in' })
  async verifyOtp(@Body() dto: VerifyOtpDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { tokens, body } = await this.auth.verifyRegistration(dto.email, dto.code, this.ctx(req));
    setRefreshCookie(res, tokens);
    return body;
  }

  @Post('resend-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle(strict)
  @ApiOperation({ summary: 'Resend the registration OTP (subject to cooldown and resend cap)' })
  resendOtp(@Body() dto: ResendOtpDto) {
    return this.auth.resendRegistrationOtp(dto.email);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle(moderate)
  @ApiOperation({ summary: 'Log in with email or phone number and password' })
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { tokens, body } = await this.auth.login(dto.identifier, dto.password, this.ctx(req));
    setRefreshCookie(res, tokens);
    return body;
  }

  @Post('login/otp/request')
  @HttpCode(HttpStatus.OK)
  @Throttle(strict)
  @ApiOperation({ summary: 'Request a one-time login code by email (or SMS when enabled)' })
  requestLoginOtp(@Body() dto: LoginOtpRequestDto) {
    return this.auth.requestLoginOtp(dto.identifier);
  }

  @Post('login/otp/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle(strict)
  @ApiOperation({ summary: 'Log in with a one-time code' })
  async verifyLoginOtp(@Body() dto: LoginOtpVerifyDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { tokens, body } = await this.auth.verifyLoginOtp(dto.identifier, dto.code, this.ctx(req));
    setRefreshCookie(res, tokens);
    return body;
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle(strict)
  @ApiOperation({ summary: 'Email a password-reset code (response is identical whether or not the account exists)' })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle(strict)
  @ApiOperation({ summary: 'Reset the password using the emailed OTP; signs out all devices' })
  resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    return this.auth.resetPassword(dto.email, dto.code, dto.newPassword, this.ctx(req));
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle(moderate)
  @ApiOperation({ summary: 'Rotate the refresh-token cookie and return a new access token' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { tokens, accessToken } = await this.auth.refresh(req.cookies?.[REFRESH_COOKIE], this.ctx(req));
    setRefreshCookie(res, tokens);
    return { accessToken };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke the current session' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.logout(req.cookies?.[REFRESH_COOKIE]);
    clearRefreshCookie(res);
    return result;
  }

  private ctx(req: Request): ClientContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }

}
