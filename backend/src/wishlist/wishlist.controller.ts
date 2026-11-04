import { Controller, Delete, Get, HttpCode, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProductStatus } from '@prisma/client';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { PricingService } from '../pricing/pricing.service';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('Wishlist')
@ApiBearerAuth()
@Controller('wishlist')
export class WishlistController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Items in the current user\'s wishlist' })
  async list(@CurrentUser() user: AuthUser, @Query('currency') currency?: string) {
    const [items, conv] = await Promise.all([
      this.prisma.wishlistItem.findMany({
        where: { wishlist: { userId: user.id }, product: { status: { in: [ProductStatus.ACTIVE, ProductStatus.OUT_OF_STOCK] } } },
        orderBy: { createdAt: 'desc' },
        select: {
          createdAt: true,
          product: {
            select: {
              id: true, name: true, slug: true, priceCny: true, stock: true, status: true, ratingAverage: true, ratingCount: true,
              images: { select: { url: true, altText: true }, orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }], take: 1 },
            },
          },
        },
      }),
      this.pricing.converter(currency),
    ]);
    return items.map(({ product: { images, ...p }, createdAt }) => ({
      addedAt: createdAt,
      ...p,
      image: images[0] ?? null,
      displayPrice: conv ? conv.convert(p.priceCny) : null,
    }));
  }

  @Post(':productId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Add a product to the wishlist (idempotent)' })
  async add(@Param('productId') productId: string, @CurrentUser() user: AuthUser) {
    const product = await this.prisma.product.findFirst({ where: { id: productId, status: { in: [ProductStatus.ACTIVE, ProductStatus.OUT_OF_STOCK] } }, select: { id: true } });
    if (!product) throw new NotFoundException('Product not found');
    const wishlist = await this.prisma.wishlist.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id } });
    await this.prisma.wishlistItem.upsert({
      where: { wishlistId_productId: { wishlistId: wishlist.id, productId } },
      update: {},
      create: { wishlistId: wishlist.id, productId },
    });
    return { productId, wishlisted: true };
  }

  @Delete(':productId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Remove a product from the wishlist (idempotent)' })
  async remove(@Param('productId') productId: string, @CurrentUser() user: AuthUser) {
    await this.prisma.wishlistItem.deleteMany({ where: { productId, wishlist: { userId: user.id } } });
    return { productId, wishlisted: false };
  }
}
