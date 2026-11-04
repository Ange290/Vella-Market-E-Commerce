import { Controller, Get, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';

class ListUsersQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize: number = 20;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
}

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

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

@Module({ controllers: [UsersController] })
export class UsersModule {}
