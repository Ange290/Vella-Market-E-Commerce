import { Body, ConflictException, Controller, Delete, Get, HttpCode, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrderStatus, Prisma, ReviewStatus } from '@prisma/client';
import { ReviewDto } from '../catalog/dto';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { PaginationQuery, pageResult, paginate } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';

/** Orders in these states never count as a completed purchase. */
const NOT_PURCHASED: OrderStatus[] = [OrderStatus.PENDING, OrderStatus.AWAITING_PAYMENT, OrderStatus.CANCELLED, OrderStatus.REFUNDED];

@ApiTags('Reviews')
@Controller('products/:slug/reviews')
export class ReviewsController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Approved reviews for a product, with rating distribution' })
  async list(@Param('slug') slug: string, @Query() q: PaginationQuery) {
    const product = await this.product(slug);
    const where = { productId: product.id, status: ReviewStatus.APPROVED };
    const [items, total, dist] = await Promise.all([
      this.prisma.review.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...paginate(q),
        select: { id: true, rating: true, title: true, comment: true, isVerifiedPurchase: true, createdAt: true, user: { select: { profile: { select: { fullName: true } } } } },
      }),
      this.prisma.review.count({ where }),
      this.prisma.review.groupBy({ by: ['rating'], where, _count: { _all: true } }),
    ]);
    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const d of dist) distribution[d.rating] = d._count._all;
    return {
      ...pageResult(
        items.map(({ user, ...r }) => ({ ...r, author: firstNameAndInitial(user.profile?.fullName) })),
        total,
        q,
      ),
      average: product.ratingAverage,
      distribution,
    };
  }

  @ApiBearerAuth()
  @Post()
  @ApiOperation({ summary: 'Review a product (one review per customer)' })
  async create(@Param('slug') slug: string, @Body() dto: ReviewDto, @CurrentUser() user: AuthUser) {
    const product = await this.product(slug);
    if (await this.prisma.review.findUnique({ where: { userId_productId: { userId: user.id, productId: product.id } } })) {
      throw new ConflictException('You have already reviewed this product');
    }
    const purchased = await this.prisma.orderItem.count({
      where: { productId: product.id, order: { userId: user.id, status: { notIn: NOT_PURCHASED } } },
    });
    const review = await this.prisma.$transaction(async (tx) => {
      const created = await tx.review.create({
        data: { userId: user.id, productId: product.id, rating: dto.rating, title: dto.title, comment: dto.comment, isVerifiedPurchase: purchased > 0 },
      });
      await this.recompute(tx, product.id);
      return created;
    });
    return review;
  }

  @ApiBearerAuth()
  @Delete()
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete your own review' })
  async remove(@Param('slug') slug: string, @CurrentUser() user: AuthUser) {
    const product = await this.product(slug);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.review.deleteMany({ where: { userId: user.id, productId: product.id } });
      if (count === 0) throw new NotFoundException('You have not reviewed this product');
      await this.recompute(tx, product.id);
    });
  }

  private async product(slug: string) {
    const p = await this.prisma.product.findUnique({ where: { slug }, select: { id: true, ratingAverage: true } });
    if (!p) throw new NotFoundException('Product not found');
    return p;
  }

  private async recompute(tx: Prisma.TransactionClient, productId: string) {
    const agg = await tx.review.aggregate({ where: { productId, status: ReviewStatus.APPROVED }, _avg: { rating: true }, _count: { _all: true } });
    await tx.product.update({
      where: { id: productId },
      data: { ratingAverage: new Prisma.Decimal(agg._avg.rating ?? 0).toDecimalPlaces(2), ratingCount: agg._count._all },
    });
  }
}

/** "Aline Uwase" → "Aline U." — public reviews never expose a full name. */
function firstNameAndInitial(fullName?: string | null): string {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Customer';
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[parts.length - 1][0]}.`;
}
