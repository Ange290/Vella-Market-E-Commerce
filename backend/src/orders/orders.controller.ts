import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrderStatus, Role } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsDateString, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { QuoteDto } from '../checkout/checkout.controller';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PaginationQuery } from '../common/pagination';
import { OrdersService } from './orders.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class CreateOrderDto extends QuoteDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) customerNote?: string;
}
class ListOrdersQuery extends PaginationQuery {
  @IsOptional() @IsEnum(OrderStatus) status?: OrderStatus;
}
class CancelOrderDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(300) reason?: string;
}
class AdminListOrdersQuery extends ListOrdersQuery {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}
class UpdateStatusDto {
  @IsEnum(OrderStatus) status!: OrderStatus;
  /** Shown to the customer on the timeline. */
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) description?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) trackingRef?: string;
}

@ApiTags('Orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @ApiOperation({ summary: 'Place an order from the cart (re-prices server-side, reserves stock, clears the cart)' })
  create(@Body() dto: CreateOrderDto, @CurrentUser() user: AuthUser) {
    return this.orders.create(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'My orders' })
  list(@Query() q: ListOrdersQuery, @CurrentUser() user: AuthUser) {
    return this.orders.listMine(user.id, q);
  }

  // Declared before ':id' so "by-number" is not captured as an id.
  @Get('by-number/:orderNumber')
  @ApiOperation({ summary: 'Look up one of my orders by its reference (order tracking page)' })
  byNumber(@Param('orderNumber') orderNumber: string, @CurrentUser() user: AuthUser) {
    return this.orders.getMineByNumber(user.id, orderNumber);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Order details with items, charges, payments, shipments and the status timeline' })
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.orders.getMine(user.id, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel an unpaid order (stock and coupon are released)' })
  cancel(@Param('id') id: string, @Body() dto: CancelOrderDto, @CurrentUser() user: AuthUser) {
    return this.orders.cancelMine(user.id, id, dto.reason);
  }
}

@ApiTags('Admin · Orders')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.STAFF)
@Controller('admin/orders')
export class AdminOrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@Query() q: AdminListOrdersQuery) {
    return this.orders.adminList(q);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.orders.adminGet(id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Advance an order through its lifecycle. PAID and REFUNDED are set only by the payments module.' })
  async updateStatus(@Param('id') id: string, @Body() dto: UpdateStatusDto, @CurrentUser() actor: AuthUser) {
    const order = await this.orders.changeStatus(id, dto.status, { description: dto.description, trackingRef: dto.trackingRef, actorId: actor.id });
    await this.audit.log({ actorId: actor.id, action: 'order.status.update', entity: 'Order', entityId: id, metadata: { to: dto.status, trackingRef: dto.trackingRef ?? null } });
    return order;
  }
}
