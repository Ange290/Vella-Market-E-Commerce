import {
  BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, Patch, Post, Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaymentStatus, Prisma, Role, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsIn, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { PHONE_E164 } from '../auth/dto/auth.dto';
import { TokenService } from '../auth/token.service';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PaginationQuery } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const normEmail = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);
const normPhone = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.replace(/[\s()-]/g, '') : value);
const PASSWORD_MSG = 'Password must be 10-128 characters and contain at least one letter and one number';
const RECEIVED: PaymentStatus[] = [PaymentStatus.SUCCESSFUL, PaymentStatus.PARTIALLY_REFUNDED, PaymentStatus.REFUNDED];

class ListCustomersQuery extends PaginationQuery {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsEnum(UserStatus) status?: UserStatus;
}
class SetStatusDto {
  @IsIn([UserStatus.ACTIVE, UserStatus.SUSPENDED]) status!: 'ACTIVE' | 'SUSPENDED';
}
class CreateStaffDto {
  @Transform(trim) @IsString() @Length(2, 100) fullName!: string;
  @Transform(normEmail) @IsEmail() email!: string;
  @IsOptional() @Transform(normPhone) @Matches(PHONE_E164, { message: 'Phone must include the country code, e.g. +250788123456' }) phone?: string;
  @IsString() @MinLength(10, { message: PASSWORD_MSG }) @MaxLength(128, { message: PASSWORD_MSG }) @Matches(/[A-Za-z]/, { message: PASSWORD_MSG }) @Matches(/\d/, { message: PASSWORD_MSG }) password!: string;
}
class SetRoleDto {
  @IsIn([Role.STAFF, Role.CUSTOMER]) role!: 'STAFF' | 'CUSTOMER';
}

/**
 * Customer and staff administration. ADMIN accounts can neither be created nor modified here
 * (they are provisioned out-of-band), so the API offers no privilege-escalation path to ADMIN.
 */
@ApiTags('Admin · People')
@ApiBearerAuth()
@Controller('admin')
export class PeopleController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  // ───── Customers ─────
  @Roles(Role.ADMIN, Role.STAFF)
  @Get('customers')
  async customers(@Query() q: ListCustomersQuery) {
    const where: Prisma.UserWhereInput = {
      role: Role.CUSTOMER,
      ...(q.status ? { status: q.status } : {}),
      ...(q.search ? { OR: [{ email: { contains: q.search, mode: 'insensitive' } }, { phone: { contains: q.search } }, { profile: { fullName: { contains: q.search, mode: 'insensitive' } } }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
        select: { id: true, email: true, phone: true, status: true, createdAt: true, lastLoginAt: true, profile: { select: { fullName: true, country: true } }, _count: { select: { orders: true } } },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items: items.map(({ _count, ...u }) => ({ ...u, orderCount: _count.orders })), total, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) };
  }

  @Roles(Role.ADMIN, Role.STAFF)
  @Get('customers/:id')
  async customer(@Param('id') id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, role: Role.CUSTOMER },
      select: {
        id: true, email: true, phone: true, status: true, emailVerifiedAt: true, createdAt: true, lastLoginAt: true,
        profile: true, addresses: { orderBy: { isDefault: 'desc' } },
        orders: { orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, orderNumber: true, status: true, total: true, currency: true, createdAt: true } },
        _count: { select: { orders: true, productRequests: true } },
      },
    });
    if (!user) throw new NotFoundException('Customer not found');
    const { _count, ...rest } = user;
    return { ...rest, orderCount: _count.orders, productRequestCount: _count.productRequests };
  }

  /** Lifetime spend is money-related, so it is a separate ADMIN-only call. */
  @Roles(Role.ADMIN)
  @Get('customers/:id/spend')
  async spend(@Param('id') id: string) {
    const rows = await this.prisma.payment.groupBy({ by: ['currency'], where: { userId: id, status: { in: RECEIVED } }, _sum: { amount: true } });
    return rows.map((r) => ({ currency: r.currency, total: (r._sum.amount ?? new Prisma.Decimal(0)).toString() }));
  }

  @Roles(Role.ADMIN)
  @Patch('customers/:id/status')
  @ApiOperation({ summary: 'Suspend or reactivate a customer. Suspending signs them out everywhere.' })
  async setStatus(@Param('id') id: string, @Body() dto: SetStatusDto, @CurrentUser() actor: AuthUser) {
    const user = await this.prisma.user.findFirst({ where: { id, role: Role.CUSTOMER } });
    if (!user) throw new NotFoundException('Customer not found');
    if (user.status === UserStatus.PENDING_VERIFICATION) throw new ConflictException('This customer has not verified their email yet');
    await this.prisma.user.update({ where: { id }, data: { status: dto.status } });
    if (dto.status === 'SUSPENDED') await this.tokens.revokeAllForUser(id);
    await this.audit.log({ actorId: actor.id, action: `customer.${dto.status.toLowerCase()}`, entity: 'User', entityId: id });
    return { id, status: dto.status };
  }

  // ───── Staff ─────
  @Roles(Role.ADMIN)
  @Get('staff')
  staff() {
    return this.prisma.user.findMany({
      where: { role: { in: [Role.STAFF, Role.ADMIN] } },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, email: true, phone: true, role: true, status: true, lastLoginAt: true, createdAt: true, profile: { select: { fullName: true } } },
    });
  }

  @Roles(Role.ADMIN)
  @Post('staff')
  @ApiOperation({ summary: 'Create a staff account with an initial password (share it securely; staff should change it)' })
  async createStaff(@Body() dto: CreateStaffDto, @CurrentUser() actor: AuthUser) {
    if (await this.prisma.user.findUnique({ where: { email: dto.email } })) throw new ConflictException('An account with this email already exists');
    if (dto.phone && (await this.prisma.user.findUnique({ where: { phone: dto.phone } }))) throw new ConflictException('An account with this phone number already exists');
    const user = await this.prisma.user.create({
      data: {
        email: dto.email, phone: dto.phone, passwordHash: await argon2.hash(dto.password, { type: argon2.argon2id }),
        role: Role.STAFF, status: UserStatus.ACTIVE, emailVerifiedAt: new Date(),
        profile: { create: { fullName: dto.fullName, country: 'RW' } },
      },
      select: { id: true, email: true, role: true, status: true, profile: { select: { fullName: true } } },
    });
    await this.audit.log({ actorId: actor.id, action: 'staff.create', entity: 'User', entityId: user.id });
    return user;
  }

  @Roles(Role.ADMIN)
  @Patch('users/:id/role')
  @ApiOperation({ summary: 'Promote a customer to STAFF or demote STAFF to CUSTOMER. ADMIN roles cannot be changed here.' })
  async setRole(@Param('id') id: string, @Body() dto: SetRoleDto, @CurrentUser() actor: AuthUser) {
    if (id === actor.id) throw new BadRequestException('You cannot change your own role');
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === Role.ADMIN) throw new ConflictException({ message: 'Administrator accounts cannot be changed through the API', code: 'ADMIN_PROTECTED' });
    if (user.status !== UserStatus.ACTIVE) throw new ConflictException('Only active, verified accounts can be given a new role');
    await this.prisma.user.update({ where: { id }, data: { role: dto.role } });
    if (dto.role === 'CUSTOMER') await this.tokens.revokeAllForUser(id); // demoted staff must sign in again
    await this.audit.log({ actorId: actor.id, action: 'user.role_change', entity: 'User', entityId: id, metadata: { from: user.role, to: dto.role } });
    return { id, role: dto.role };
  }

  @Roles(Role.ADMIN)
  @Patch('staff/:id/status')
  async setStaffStatus(@Param('id') id: string, @Body() dto: SetStatusDto, @CurrentUser() actor: AuthUser) {
    if (id === actor.id) throw new BadRequestException('You cannot suspend yourself');
    const user = await this.prisma.user.findFirst({ where: { id, role: Role.STAFF } });
    if (!user) throw new NotFoundException('Staff member not found');
    await this.prisma.user.update({ where: { id }, data: { status: dto.status } });
    if (dto.status === 'SUSPENDED') await this.tokens.revokeAllForUser(id);
    await this.audit.log({ actorId: actor.id, action: `staff.${dto.status.toLowerCase()}`, entity: 'User', entityId: id });
    return { id, status: dto.status };
  }
}
