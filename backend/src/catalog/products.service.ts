import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProductStatus } from '@prisma/client';
import { pageResult, paginate } from '../common/pagination';
import { uniqueSlug } from '../common/slug';
import { Converter, PricingService } from '../pricing/pricing.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminListProductsQuery, CreateProductDto, ListProductsQuery, ProductSort, UpdateProductDto, UpdateVariantDto, VariantInputDto } from './dto';

const PUBLIC_STATUSES: ProductStatus[] = [ProductStatus.ACTIVE, ProductStatus.OUT_OF_STOCK];

const listSelect = {
  id: true,
  sku: true,
  name: true,
  slug: true,
  priceCny: true,
  stock: true,
  status: true,
  ratingAverage: true,
  ratingCount: true,
  processingDaysMin: true,
  processingDaysMax: true,
  shippingDaysMin: true,
  shippingDaysMax: true,
  category: { select: { id: true, name: true, slug: true } },
  images: { select: { url: true, altText: true }, orderBy: [{ isPrimary: 'desc' as const }, { sortOrder: 'asc' as const }], take: 1 },
} satisfies Prisma.ProductSelect;

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  // ───────────── Public ─────────────

  async list(q: ListProductsQuery, opts: { admin?: { status?: ProductStatus } } = {}) {
    const where = await this.buildWhere(q, opts.admin);
    const [rows, total, conv] = await Promise.all([
      this.prisma.product.findMany({ where, select: listSelect, orderBy: this.orderBy(q.sort), ...paginate(q) }),
      this.prisma.product.count({ where }),
      this.pricing.converter(q.currency),
    ]);
    return { ...pageResult(rows.map((p) => this.presentListItem(p, conv)), total, q), currency: conv?.currency ?? null };
  }

  async detail(slug: string, currency?: string) {
    const product = await this.prisma.product.findFirst({
      where: { slug, status: { in: PUBLIC_STATUSES } },
      select: {
        id: true, sku: true, name: true, slug: true, description: true, priceCny: true, specifications: true, stock: true, status: true,
        weightGrams: true, ratingAverage: true, ratingCount: true,
        processingDaysMin: true, processingDaysMax: true, shippingDaysMin: true, shippingDaysMax: true,
        createdAt: true,
        category: { select: { id: true, name: true, slug: true, parent: { select: { id: true, name: true, slug: true } } } },
        // Only non-sensitive supplier facts are public; contact details and the source URL stay private.
        supplier: { select: { id: true, name: true, country: true, city: true, platform: true } },
        images: { select: { id: true, url: true, altText: true, isPrimary: true }, orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }] },
        variants: { where: { isActive: true }, select: { id: true, sku: true, size: true, color: true, priceDeltaCny: true, stock: true }, orderBy: [{ size: 'asc' }, { color: 'asc' }] },
      },
    });
    if (!product) throw new NotFoundException('Product not found');
    const conv = await this.pricing.converter(currency);
    const { variants, ...rest } = product;
    return {
      ...rest,
      displayPrice: conv ? conv.convert(product.priceCny) : null,
      sizes: [...new Set(variants.map((v) => v.size).filter(Boolean))],
      colors: [...new Set(variants.map((v) => v.color).filter(Boolean))],
      variants: variants.map((v) => ({
        ...v,
        finalPriceCny: product.priceCny.add(v.priceDeltaCny).toFixed(2),
        displayPrice: conv ? conv.convert(product.priceCny.add(v.priceDeltaCny)) : null,
      })),
    };
  }

  async related(slug: string, currency?: string, limit = 8) {
    const base = await this.prisma.product.findFirst({ where: { slug, status: { in: PUBLIC_STATUSES } }, select: { id: true, categoryId: true } });
    if (!base) throw new NotFoundException('Product not found');
    const [rows, conv] = await Promise.all([
      this.prisma.product.findMany({
        where: { categoryId: base.categoryId, id: { not: base.id }, status: { in: PUBLIC_STATUSES } },
        select: listSelect,
        orderBy: [{ ratingCount: 'desc' }, { createdAt: 'desc' }],
        take: limit,
      }),
      this.pricing.converter(currency),
    ]);
    return rows.map((p) => this.presentListItem(p, conv));
  }

  // ───────────── Admin ─────────────

  adminList(q: AdminListProductsQuery) {
    return this.list(q, { admin: { status: q.status } });
  }

  async adminGet(id: string) {
    return this.prisma.product.findUniqueOrThrow({
      where: { id },
      include: { images: { orderBy: { sortOrder: 'asc' } }, variants: true, category: true, supplier: true },
    });
  }

  async create(dto: CreateProductDto) {
    await this.assertRefs(dto.categoryId, dto.supplierId);
    this.assertRanges(dto);
    this.assertUniqueVariants(dto.variants ?? []);
    const slug = await uniqueSlug(dto.name, async (s) => !!(await this.prisma.product.findUnique({ where: { slug: s } })));
    try {
      return await this.prisma.product.create({
        data: {
          sku: dto.sku,
          name: dto.name,
          slug,
          description: dto.description,
          categoryId: dto.categoryId,
          supplierId: dto.supplierId,
          priceCny: dto.priceCny,
          specifications: (dto.specifications ?? {}) as Prisma.InputJsonValue,
          sourceUrl: dto.sourceUrl,
          stock: dto.stock ?? 0,
          weightGrams: dto.weightGrams,
          processingDaysMin: dto.processingDaysMin,
          processingDaysMax: dto.processingDaysMax,
          shippingDaysMin: dto.shippingDaysMin,
          shippingDaysMax: dto.shippingDaysMax,
          status: dto.status ?? ProductStatus.DRAFT,
          images: { create: (dto.images ?? []).map((i, idx) => ({ url: i.url, altText: i.altText, sortOrder: idx, isPrimary: idx === 0 })) },
          variants: { create: (dto.variants ?? []).map((v) => this.variantData(v)) },
        },
        include: { images: true, variants: true },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('A product or variant with this SKU already exists');
      throw e;
    }
  }

  async update(id: string, dto: UpdateProductDto) {
    const current = await this.prisma.product.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Product not found');
    if (dto.categoryId || dto.supplierId) await this.assertRefs(dto.categoryId ?? current.categoryId, dto.supplierId);
    this.assertRanges({
      processingDaysMin: dto.processingDaysMin ?? current.processingDaysMin,
      processingDaysMax: dto.processingDaysMax ?? current.processingDaysMax,
      shippingDaysMin: dto.shippingDaysMin ?? current.shippingDaysMin,
      shippingDaysMax: dto.shippingDaysMax ?? current.shippingDaysMax,
    });
    const { specifications, ...rest } = dto;
    try {
      return await this.prisma.product.update({
        where: { id },
        data: { ...rest, ...(specifications ? { specifications: specifications as Prisma.InputJsonValue } : {}) },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('A product with this SKU already exists');
      throw e;
    }
  }

  /** Products referenced by orders are archived, never hard-deleted, so order history stays intact. */
  async archive(id: string) {
    return this.prisma.product.update({ where: { id }, data: { status: ProductStatus.ARCHIVED } });
  }

  async addVariant(productId: string, dto: VariantInputDto) {
    await this.prisma.product.findUniqueOrThrow({ where: { id: productId } });
    try {
      return await this.prisma.productVariant.create({ data: { productId, ...this.variantData(dto) } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Variant SKU or size/colour combination already exists');
      throw e;
    }
  }

  updateVariant(id: string, dto: UpdateVariantDto) {
    return this.prisma.productVariant.update({ where: { id }, data: dto });
  }

  /** Variants are deactivated rather than deleted so past orders and carts keep valid references. */
  deactivateVariant(id: string) {
    return this.prisma.productVariant.update({ where: { id }, data: { isActive: false } });
  }

  async addImage(productId: string, url: string, altText?: string) {
    await this.prisma.product.findUniqueOrThrow({ where: { id: productId } });
    const count = await this.prisma.productImage.count({ where: { productId } });
    if (count >= 12) throw new BadRequestException('A product can have at most 12 images');
    return this.prisma.productImage.create({ data: { productId, url, altText, sortOrder: count, isPrimary: count === 0 } });
  }

  async removeImage(id: string) {
    const img = await this.prisma.productImage.delete({ where: { id } });
    if (img.isPrimary) {
      const next = await this.prisma.productImage.findFirst({ where: { productId: img.productId }, orderBy: { sortOrder: 'asc' } });
      if (next) await this.prisma.productImage.update({ where: { id: next.id }, data: { isPrimary: true } });
    }
    return img;
  }

  // ───────────── helpers ─────────────

  private async buildWhere(q: ListProductsQuery, admin?: { status?: ProductStatus }): Promise<Prisma.ProductWhereInput> {
    const and: Prisma.ProductWhereInput[] = [];
    if (admin) {
      if (admin.status) and.push({ status: admin.status });
    } else {
      and.push({ status: { in: PUBLIC_STATUSES } });
    }
    if (q.q) {
      and.push({
        OR: [
          { name: { contains: q.q, mode: 'insensitive' } },
          { description: { contains: q.q, mode: 'insensitive' } },
          { sku: { contains: q.q, mode: 'insensitive' } },
        ],
      });
    }
    if (q.category) {
      const cat = await this.prisma.category.findUnique({ where: { slug: q.category }, include: { children: { select: { id: true } } } });
      and.push({ categoryId: { in: cat ? [cat.id, ...cat.children.map((c) => c.id)] : ['__none__'] } });
    }
    if (q.minPrice !== undefined || q.maxPrice !== undefined) {
      if (q.minPrice && q.maxPrice && new Prisma.Decimal(q.minPrice).gt(q.maxPrice)) throw new BadRequestException('minPrice cannot exceed maxPrice');
      and.push({ priceCny: { ...(q.minPrice ? { gte: q.minPrice } : {}), ...(q.maxPrice ? { lte: q.maxPrice } : {}) } });
    }
    return { AND: and };
  }

  private orderBy(sort: ProductSort): Prisma.ProductOrderByWithRelationInput[] {
    switch (sort) {
      case ProductSort.PRICE_ASC: return [{ priceCny: 'asc' }, { id: 'asc' }];
      case ProductSort.PRICE_DESC: return [{ priceCny: 'desc' }, { id: 'asc' }];
      case ProductSort.RATING: return [{ ratingAverage: 'desc' }, { ratingCount: 'desc' }, { id: 'asc' }];
      case ProductSort.NAME: return [{ name: 'asc' }, { id: 'asc' }];
      default: return [{ createdAt: 'desc' }, { id: 'asc' }];
    }
  }

  private presentListItem(p: Prisma.ProductGetPayload<{ select: typeof listSelect }>, conv: Converter | null) {
    const { images, ...rest } = p;
    return { ...rest, image: images[0] ?? null, inStock: p.stock > 0 && p.status === ProductStatus.ACTIVE, displayPrice: conv ? conv.convert(p.priceCny) : null };
  }

  private variantData(v: VariantInputDto) {
    return { sku: v.sku, size: v.size || null, color: v.color || null, priceDeltaCny: v.priceDeltaCny ?? '0', stock: v.stock ?? 0, isActive: v.isActive ?? true };
  }

  private assertUniqueVariants(variants: VariantInputDto[]) {
    const seen = new Set<string>();
    for (const v of variants) {
      for (const key of [`sku:${v.sku}`, `combo:${v.size ?? ''}|${v.color ?? ''}`]) {
        if (seen.has(key)) throw new BadRequestException('Duplicate variant SKU or size/colour combination in request');
        seen.add(key);
      }
    }
  }

  private assertRanges(r: { processingDaysMin?: number; processingDaysMax?: number; shippingDaysMin?: number; shippingDaysMax?: number }) {
    if ((r.processingDaysMin ?? 0) > (r.processingDaysMax ?? Infinity)) throw new BadRequestException('processingDaysMin cannot exceed processingDaysMax');
    if ((r.shippingDaysMin ?? 0) > (r.shippingDaysMax ?? Infinity)) throw new BadRequestException('shippingDaysMin cannot exceed shippingDaysMax');
  }

  private async assertRefs(categoryId: string, supplierId?: string) {
    if (!(await this.prisma.category.findUnique({ where: { id: categoryId } }))) throw new BadRequestException('Category not found');
    if (supplierId && !(await this.prisma.supplier.findUnique({ where: { id: supplierId } }))) throw new BadRequestException('Supplier not found');
  }
}
