import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { uniqueSlug } from '../common/slug';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto';

@ApiTags('Categories')
@Controller()
export class CategoriesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Public()
  @Get('categories')
  @ApiOperation({ summary: 'Active category tree with product counts' })
  async tree() {
    const [cats, counts] = await Promise.all([
      this.prisma.category.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      this.prisma.product.groupBy({ by: ['categoryId'], where: { status: 'ACTIVE' }, _count: { _all: true } }),
    ]);
    const countMap = new Map(counts.map((c) => [c.categoryId, c._count._all]));
    const nodes = new Map(cats.map((c) => [c.id, { ...c, productCount: countMap.get(c.id) ?? 0, children: [] as any[] }]));
    const roots: any[] = [];
    for (const n of nodes.values()) {
      const parent = n.parentId ? nodes.get(n.parentId) : undefined;
      if (parent) parent.children.push(n);
      else roots.push(n);
    }
    return roots;
  }

  @Public()
  @Get('categories/:slug')
  async bySlug(@Param('slug') slug: string) {
    const cat = await this.prisma.category.findFirst({
      where: { slug, isActive: true },
      include: { children: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } }, parent: { select: { id: true, name: true, slug: true } } },
    });
    if (!cat) throw new NotFoundException('Category not found');
    return cat;
  }

  @Roles(Role.ADMIN, Role.STAFF)
  @ApiBearerAuth()
  @Get('admin/categories')
  @ApiOperation({ summary: 'All categories including inactive (ADMIN/STAFF)' })
  adminList() {
    return this.prisma.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], include: { _count: { select: { products: true } } } });
  }

  @Roles(Role.ADMIN, Role.STAFF)
  @ApiBearerAuth()
  @Post('admin/categories')
  async create(@Body() dto: CreateCategoryDto, @CurrentUser() actor: AuthUser) {
    if (dto.parentId) await this.assertParent(dto.parentId);
    const slug = await uniqueSlug(dto.name, async (s) => !!(await this.prisma.category.findUnique({ where: { slug: s } })));
    const cat = await this.prisma.category.create({ data: { ...dto, slug } });
    await this.audit.log({ actorId: actor.id, action: 'category.create', entity: 'Category', entityId: cat.id });
    return cat;
  }

  @Roles(Role.ADMIN, Role.STAFF)
  @ApiBearerAuth()
  @Patch('admin/categories/:id')
  async update(@Param('id') id: string, @Body() dto: UpdateCategoryDto, @CurrentUser() actor: AuthUser) {
    if (dto.parentId) {
      if (dto.parentId === id) throw new BadRequestException('A category cannot be its own parent');
      await this.assertParent(dto.parentId);
      // prevent cycles: the new parent must not be a descendant of this category
      let cursor: string | null = dto.parentId;
      for (let i = 0; cursor && i < 20; i++) {
        const p: { parentId: string | null } | null = await this.prisma.category.findUnique({ where: { id: cursor }, select: { parentId: true } });
        if (p?.parentId === id) throw new BadRequestException('Parent would create a cycle');
        cursor = p?.parentId ?? null;
      }
    }
    const cat = await this.prisma.category.update({ where: { id }, data: dto });
    await this.audit.log({ actorId: actor.id, action: 'category.update', entity: 'Category', entityId: id, metadata: { fields: Object.keys(dto) } });
    return cat;
  }

  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @Delete('admin/categories/:id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    const [products, children] = await Promise.all([
      this.prisma.product.count({ where: { categoryId: id } }),
      this.prisma.category.count({ where: { parentId: id } }),
    ]);
    if (products || children) throw new ConflictException('Category still has products or sub-categories; deactivate it instead');
    await this.prisma.category.delete({ where: { id } });
    await this.audit.log({ actorId: actor.id, action: 'category.delete', entity: 'Category', entityId: id });
  }

  private async assertParent(parentId: string) {
    if (!(await this.prisma.category.findUnique({ where: { id: parentId } }))) throw new BadRequestException('Parent category not found');
  }
}
