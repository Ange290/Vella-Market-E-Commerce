import { BadRequestException, Body, Controller, Get, HttpCode, Module, Patch, Post, Query, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import type { Request, Response } from 'express';
import { AuditService } from '../audit/audit.service';
import { AuthModule } from '../auth/auth.module';
import { setRefreshCookie } from '../auth/cookie';
import { TokenService } from '../auth/token.service';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AddressesController } from './addresses.controller';

const PASSWORD_MSG = 'Password must be 10-128 characters and contain at least one letter and one number';
const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);

class UpdateProfileDto {
  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @Length(2, 100) fullName?: string;
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{2}$/, { message: 'Country must be an ISO alpha-2 code' }) country?: string;
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{3}$/) preferredCurrency?: string;
  @IsOptional() @IsIn(['en', 'fr', 'rw']) preferredLanguage?: string;
}
class ChangePasswordDto {
  @IsString() @MaxLength(128) currentPassword!: string;
  @IsString() @MinLength(10, { message: PASSWORD_MSG }) @MaxLength(128, { message: PASSWORD_MSG }) @Matches(/[A-Za-z]/, { message: PASSWORD_MSG }) @Matches(/\d/, { message: PASSWORD_MSG }) newPassword!: string;
}

class ListUsersQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize: number = 20;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
}

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'Current user profile' })
  async me(@CurrentUser() auth: AuthUser) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: auth.id },
      select: {
        id: true, email: true, phone: true, role: true, status: true, emailVerifiedAt: true, createdAt: true,
        profile: { select: { fullName: true, country: true, preferredCurrency: true, preferredLanguage: true, avatarUrl: true } },
      },
    });
    return user;
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update my profile (name, country, display currency, language). Email and phone changes are not self-service.' })
  async updateMe(@Body() dto: UpdateProfileDto, @CurrentUser() auth: AuthUser) {
    if (dto.preferredCurrency && dto.preferredCurrency !== 'CNY' && !(await this.prisma.currency.findFirst({ where: { code: dto.preferredCurrency, isActive: true } }))) {
      throw new BadRequestException('Unknown or inactive currency');
    }
    await this.prisma.userProfile.update({ where: { userId: auth.id }, data: dto });
    await this.audit.log({ actorId: auth.id, action: 'user.profile_update', entity: 'User', entityId: auth.id, metadata: { fields: Object.keys(dto) } });
    return this.me(auth);
  }

  @Post('me/password')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Change my password. Signs out every other device and keeps this one signed in.' })
  async changePassword(@Body() dto: ChangePasswordDto, @CurrentUser() auth: AuthUser, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.id } });
    if (!(await argon2.verify(user.passwordHash, dto.currentPassword).catch(() => false))) {
      await this.audit.log({ actorId: auth.id, action: 'user.password_change_failed', entity: 'User', entityId: auth.id, ipAddress: req.ip });
      throw new UnauthorizedException('Your current password is incorrect');
    }
    if (dto.currentPassword === dto.newPassword) throw new BadRequestException('Choose a password you have not used just now');
    await this.prisma.user.update({ where: { id: auth.id }, data: { passwordHash: await argon2.hash(dto.newPassword, { type: argon2.argon2id }) } });
    await this.tokens.revokeAllForUser(auth.id);
    const tokens = await this.tokens.issue({ id: user.id, role: user.role }, { ip: req.ip, userAgent: req.headers['user-agent'] });
    setRefreshCookie(res, tokens);
    await this.audit.log({ actorId: auth.id, action: 'user.password_change', entity: 'User', entityId: auth.id, ipAddress: req.ip });
    return { message: 'Password updated. Other devices have been signed out.', accessToken: tokens.accessToken };
  }

  @Get()
  @Roles(Role.ADMIN, Role.STAFF)
  @ApiOperation({ summary: 'List users (ADMIN / STAFF only)' })
  async list(@Query() q: ListUsersQuery) {
    const where = q.search
      ? {
          OR: [
            { email: { contains: q.search, mode: 'insensitive' as const } },
            { phone: { contains: q.search } },
            { profile: { fullName: { contains: q.search, mode: 'insensitive' as const } } },
          ],
        }
      : {};
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: { id: true, email: true, phone: true, role: true, status: true, createdAt: true, profile: { select: { fullName: true, country: true } } },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }
}

@Module({ imports: [AuthModule], controllers: [UsersController, AddressesController] })
export class UsersModule {}
