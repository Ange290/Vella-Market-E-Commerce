import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { OtpChannel, OtpPurpose, Prisma, User, UserProfile, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { OtpService } from '../otp/otp.service';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import { PHONE_E164, RegisterDto } from './dto/auth.dto';
import { ClientContext, TokenService } from './token.service';

type UserWithProfile = User & { profile: UserProfile | null };

const GENERIC_OTP_MESSAGE = 'If the account exists, a verification code has been sent.';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  /** Verified against when a user is not found, so response time doesn't reveal account existence. */
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly mail: MailService,
    private readonly sms: SmsService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  // ───────────── Registration ─────────────

  async register(dto: RegisterDto, ctx: ClientContext) {
    if (dto.password !== dto.confirmPassword) throw new BadRequestException('Passwords do not match');

    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    const byEmail = await this.prisma.user.findUnique({ where: { email: dto.email } });
    const byPhone = await this.prisma.user.findUnique({ where: { phone: dto.phone } });

    if (byEmail && byEmail.status !== UserStatus.PENDING_VERIFICATION) {
      throw new ConflictException('An account with this email already exists');
    }
    if (byPhone && byPhone.id !== byEmail?.id) {
      throw new ConflictException('An account with this phone number already exists');
    }

    let user: User;
    if (byEmail) {
      // Unverified sign-up being retried: refresh details, then re-send the code.
      user = await this.prisma.user.update({
        where: { id: byEmail.id },
        data: {
          phone: dto.phone,
          passwordHash,
          profile: { update: { fullName: dto.fullName, country: dto.country } },
        },
      });
    } else {
      user = await this.prisma.user.create({
        data: {
          email: dto.email,
          phone: dto.phone,
          passwordHash,
          profile: { create: { fullName: dto.fullName, country: dto.country } },
          addresses: {
            create: {
              recipientName: dto.fullName,
              phone: dto.phone,
              country: dto.country,
              region: dto.region,
              city: dto.city,
              street: dto.addressLine,
              postalCode: dto.postalCode,
              isDefault: true,
            },
          },
        },
      });
    }

    const cooldownSeconds = await this.sendEmailOtp(user, OtpPurpose.REGISTRATION);
    await this.audit.log({ actorId: user.id, action: 'auth.register', entity: 'User', entityId: user.id, ipAddress: ctx.ip, userAgent: ctx.userAgent });
    return { message: 'Account created. Enter the 6-digit code we emailed you to activate it.', email: user.email, resendAvailableInSeconds: cooldownSeconds };
  }

  async verifyRegistration(email: string, code: string, ctx: ClientContext) {
    const { userId } = await this.otp.verify(email, OtpPurpose.REGISTRATION, code);
    if (!userId) throw new BadRequestException('Invalid or expired code');
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { status: UserStatus.ACTIVE, emailVerifiedAt: new Date() },
      include: { profile: true },
    });
    await this.audit.log({ actorId: user.id, action: 'auth.verify_email', entity: 'User', entityId: user.id, ipAddress: ctx.ip, userAgent: ctx.userAgent });
    return this.session(user, ctx);
  }

  async resendRegistrationOtp(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user && user.status === UserStatus.PENDING_VERIFICATION) {
      const cooldownSeconds = await this.sendEmailOtp(user, OtpPurpose.REGISTRATION);
      return { message: GENERIC_OTP_MESSAGE, resendAvailableInSeconds: cooldownSeconds };
    }
    return { message: GENERIC_OTP_MESSAGE };
  }

  // ───────────── Password login ─────────────

  async login(identifier: string, password: string, ctx: ClientContext) {
    const user = await this.findByIdentifier(identifier);
    const hash = user?.passwordHash ?? (await this.getDummyHash());
    const valid = await argon2.verify(hash, password).catch(() => false);
    if (!user || !valid) {
      await this.audit.log({ action: 'auth.login_failed', entity: 'User', entityId: user?.id, metadata: { identifierType: identifier.includes('@') ? 'email' : 'phone' }, ipAddress: ctx.ip, userAgent: ctx.userAgent });
      throw new UnauthorizedException('Invalid credentials');
    }
    this.assertCanLogin(user);
    return this.session(user, ctx);
  }

  // ───────────── OTP login (email or SMS) ─────────────

  async requestLoginOtp(identifier: string) {
    const isEmail = identifier.includes('@');
    if (!isEmail && !this.sms.enabled) throw new BadRequestException('SMS login is not available. Use your email address.');
    const user = await this.findByIdentifier(identifier);
    if (user && user.status === UserStatus.ACTIVE) {
      try {
        await this.sendOtp(user, OtpPurpose.LOGIN, isEmail ? OtpChannel.EMAIL : OtpChannel.SMS);
      } catch (err) {
        if (err instanceof HttpException && err.getStatus() === 429) throw err;
        this.logger.error(`Login OTP delivery failed: ${(err as Error).message}`);
      }
    }
    return { message: GENERIC_OTP_MESSAGE };
  }

  async verifyLoginOtp(identifier: string, code: string, ctx: ClientContext) {
    const user = await this.findByIdentifier(identifier);
    const target = user ? (identifier.includes('@') ? user.email : user.phone!) : identifier.toLowerCase();
    await this.otp.verify(target, OtpPurpose.LOGIN, code); // throws a generic error when no OTP exists
    if (!user) throw new UnauthorizedException('Invalid credentials');
    this.assertCanLogin(user);
    return this.session(user, ctx);
  }

  // ───────────── Password reset ─────────────

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user && user.status === UserStatus.ACTIVE) {
      try {
        await this.sendEmailOtp(user, OtpPurpose.PASSWORD_RESET);
      } catch (err) {
        // Cooldown/cap/delivery errors are swallowed so the response never reveals whether the account exists.
        this.logger.warn(`Password reset OTP not sent: ${(err as Error).message}`);
      }
    }
    return { message: GENERIC_OTP_MESSAGE };
  }

  async resetPassword(email: string, code: string, newPassword: string, ctx: ClientContext) {
    await this.otp.verify(email, OtpPurpose.PASSWORD_RESET, code);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== UserStatus.ACTIVE) throw new BadRequestException('Invalid or expired code');
    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    await this.tokens.revokeAllForUser(user.id); // log out every device
    await this.audit.log({ actorId: user.id, action: 'auth.password_reset', entity: 'User', entityId: user.id, ipAddress: ctx.ip, userAgent: ctx.userAgent });
    return { message: 'Password updated. Please log in with your new password.' };
  }

  // ───────────── Sessions ─────────────

  async refresh(rawToken: string | undefined, ctx: ClientContext) {
    if (!rawToken) throw new UnauthorizedException('No session');
    const { tokens, user } = await this.tokens.rotate(rawToken, ctx);
    return { tokens, accessToken: tokens.accessToken, userId: user.id };
  }

  async logout(rawToken: string | undefined) {
    if (rawToken) await this.tokens.revokeByToken(rawToken);
    return { message: 'Logged out' };
  }

  // ───────────── helpers ─────────────

  private async session(user: UserWithProfile | User, ctx: ClientContext) {
    const full: UserWithProfile =
      'profile' in user ? user : { ...user, profile: await this.prisma.userProfile.findUnique({ where: { userId: user.id } }) };
    const tokens = await this.tokens.issue(full, ctx);
    await this.prisma.user.update({ where: { id: full.id }, data: { lastLoginAt: new Date() } });
    return {
      tokens,
      body: {
        accessToken: tokens.accessToken,
        user: { id: full.id, email: full.email, role: full.role, fullName: full.profile?.fullName ?? null },
      },
    };
  }

  private assertCanLogin(user: User) {
    if (user.status === UserStatus.PENDING_VERIFICATION) {
      throw new ForbiddenException({ message: 'Please verify your email before logging in', code: 'ACCOUNT_NOT_VERIFIED' });
    }
    if (user.status === UserStatus.SUSPENDED) throw new ForbiddenException('This account has been suspended');
  }

  private async findByIdentifier(identifier: string): Promise<UserWithProfile | null> {
    const value = identifier.trim();
    const where: Prisma.UserWhereUniqueInput = value.includes('@')
      ? { email: value.toLowerCase() }
      : { phone: value.replace(/[\s()-]/g, '') };
    if (!value.includes('@') && !PHONE_E164.test((where as { phone: string }).phone)) return null;
    return this.prisma.user.findUnique({ where, include: { profile: true } });
  }

  private sendEmailOtp(user: User, purpose: OtpPurpose) {
    return this.sendOtp(user, purpose, OtpChannel.EMAIL);
  }

  /** Issues an OTP and delivers it. Returns the resend cooldown in seconds. */
  private async sendOtp(user: User, purpose: OtpPurpose, channel: OtpChannel): Promise<number> {
    const target = channel === OtpChannel.EMAIL ? user.email : user.phone!;
    const { code, cooldownSeconds } = await this.otp.issue({ target, channel, purpose, userId: user.id });
    if (channel === OtpChannel.EMAIL) await this.mail.sendOtp(target, code, purpose);
    else await this.sms.sendOtp(target, code);
    return cooldownSeconds;
  }

  private getDummyHash() {
    this.dummyHash ??= argon2.hash('vella-dummy-password', { type: argon2.argon2id });
    return this.dummyHash;
  }
}
