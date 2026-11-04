import { Body, ConflictException, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PaginationQuery, pageResult, paginate } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSupplierDto, UpdateSupplierDto } from './dto';

class ListSuppliersQuery extends PaginationQuery {
  @IsOptional() @IsString() @MaxLength(100) search?: string;
}

/** Supplier records contain private contact data, so every route here is ADMIN/STAFF only. */
@ApiTags('Suppliers')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.STAFF)
@Controller('admin/suppliers')
export class SuppliersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@Query() q: ListSuppliersQuery) {
    const where = q.search ? { name: { contains: q.search, mode: 'insensitive' as const } } : {};
    const [items, total] = await Promise.all([
      this.prisma.supplier.findMany({ where, orderBy: { name: 'asc' }, ...paginate(q), include: { _count: { select: { products: true } } } }),
      this.prisma.supplier.count({ where }),
    ]);
    return pageResult(items, total, q);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.prisma.supplier.findUniqueOrThrow({ where: { id } });
  }

  @Post()
  async create(@Body() dto: CreateSupplierDto, @CurrentUser() actor: AuthUser) {
    const s = await this.prisma.supplier.create({ data: dto });
    await this.audit.log({ actorId: actor.id, action: 'supplier.create', entity: 'Supplier', entityId: s.id });
    return s;
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateSupplierDto, @CurrentUser() actor: AuthUser) {
    const s = await this.prisma.supplier.update({ where: { id }, data: dto });
    await this.audit.log({ actorId: actor.id, action: 'supplier.update', entity: 'Supplier', entityId: id, metadata: { fields: Object.keys(dto) } });
    return s;
  }

  @Roles(Role.ADMIN)
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    if (await this.prisma.product.count({ where: { supplierId: id } })) {
      throw new ConflictException('Supplier still has products; deactivate it instead');
    }
    await this.prisma.supplier.delete({ where: { id } });
    await this.audit.log({ actorId: actor.id, action: 'supplier.delete', entity: 'Supplier', entityId: id });
  }
}
