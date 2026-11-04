import { Controller, Get, HttpCode, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { PaginationQuery, pageResult, paginate } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';

class ListNotificationsQuery extends PaginationQuery {
  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() unreadOnly?: boolean;
}

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Query() q: ListNotificationsQuery, @CurrentUser() user: AuthUser) {
    const where = { userId: user.id, ...(q.unreadOnly ? { readAt: null } : {}) };
    const [items, total, unread] = await Promise.all([
      this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, ...paginate(q) }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    ]);
    return { ...pageResult(items, total, q), unread };
  }

  @Post('read-all')
  @HttpCode(200)
  async readAll(@CurrentUser() user: AuthUser) {
    const { count } = await this.prisma.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return { updated: count };
  }

  @Post(':id/read')
  @HttpCode(200)
  async read(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const { count } = await this.prisma.notification.updateMany({ where: { id, userId: user.id, readAt: null }, data: { readAt: new Date() } });
    if (count === 0 && !(await this.prisma.notification.findFirst({ where: { id, userId: user.id } }))) throw new NotFoundException('Notification not found');
    return { id, read: true };
  }
}
