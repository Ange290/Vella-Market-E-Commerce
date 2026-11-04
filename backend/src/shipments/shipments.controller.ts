import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role, ShipmentStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PaginationQuery } from '../common/pagination';
import { ShipmentsService } from './shipments.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const toStr = ({ value }: { value: unknown }) => (typeof value === 'number' ? String(value) : value);

class CreateShipmentDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(80) carrier?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) trackingNumber?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) weightGrams?: number;
  @IsOptional() @Transform(toStr) @Matches(/^\d{1,12}(\.\d{1,2})?$/, { message: 'cost must be a non-negative amount' }) cost?: string;
  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value)) @Matches(/^[A-Z]{3}$/) costCurrency?: string;
  @IsOptional() @IsDateString() estimatedDelivery?: string;
}
class UpdateShipmentDto extends CreateShipmentDto {}
class AddEventDto {
  @IsEnum(ShipmentStatus) status!: ShipmentStatus;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) location?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsDateString() occurredAt?: string;
}
class ListShipmentsQuery extends PaginationQuery {
  @IsOptional() @IsEnum(ShipmentStatus) status?: ShipmentStatus;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) search?: string;
}

@ApiTags('Shipments')
@ApiBearerAuth()
@Controller()
export class ShipmentsController {
  constructor(private readonly shipments: ShipmentsService) {}

  @Get('orders/:orderId/shipments')
  @ApiOperation({ summary: 'Shipments and tracking events for one of my orders' })
  mine(@Param('orderId') orderId: string, @CurrentUser() user: AuthUser) {
    return this.shipments.listForCustomer(user.id, orderId);
  }
}

@ApiTags('Admin · Shipments')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.STAFF)
@Controller('admin')
export class AdminShipmentsController {
  constructor(
    private readonly shipments: ShipmentsService,
    private readonly audit: AuditService,
  ) {}

  @Get('shipments')
  list(@Query() q: ListShipmentsQuery) {
    return this.shipments.adminList(q);
  }

  @Get('shipments/:id')
  get(@Param('id') id: string) {
    return this.shipments.get(id);
  }

  @Post('orders/:orderId/shipments')
  @ApiOperation({ summary: 'Create a shipment for a paid order that is being processed' })
  async create(@Param('orderId') orderId: string, @Body() dto: CreateShipmentDto, @CurrentUser() actor: AuthUser) {
    const s = await this.shipments.create(orderId, dto);
    await this.audit.log({ actorId: actor.id, action: 'shipment.create', entity: 'Shipment', entityId: s.id, metadata: { orderId } });
    return s;
  }

  @Patch('shipments/:id')
  async update(@Param('id') id: string, @Body() dto: UpdateShipmentDto, @CurrentUser() actor: AuthUser) {
    const s = await this.shipments.update(id, dto);
    await this.audit.log({ actorId: actor.id, action: 'shipment.update', entity: 'Shipment', entityId: id, metadata: { fields: Object.keys(dto) } });
    return s;
  }

  @Post('shipments/:id/events')
  @ApiOperation({ summary: 'Add a tracking event; the order status follows when all its shipments reach the stage' })
  async addEvent(@Param('id') id: string, @Body() dto: AddEventDto, @CurrentUser() actor: AuthUser) {
    const s = await this.shipments.addEvent(id, dto, actor.id);
    await this.audit.log({ actorId: actor.id, action: 'shipment.event', entity: 'Shipment', entityId: id, metadata: { status: dto.status } });
    return s;
  }

  @Delete('shipments/:id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    await this.shipments.remove(id);
    await this.audit.log({ actorId: actor.id, action: 'shipment.delete', entity: 'Shipment', entityId: id });
  }
}
