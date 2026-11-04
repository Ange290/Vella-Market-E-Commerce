import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProductStatus } from '@prisma/client';
import { Converter, PricingService } from '../pricing/pricing.service';
import { PrismaService } from '../prisma/prisma.service';

export const MAX_LINE_QUANTITY = 99;

const cartInclude = {
  items: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      product: {
        select: {
          id: true, name: true, slug: true, sku: true, priceCny: true, stock: true, status: true, weightGrams: true,
          images: { select: { url: true, altText: true }, orderBy: [{ isPrimary: 'desc' as const }, { sortOrder: 'asc' as const }], take: 1 },
        },
      },
      variant: true,
    },
  },
} satisfies Prisma.CartInclude;

export type CartWithItems = Prisma.CartGetPayload<{ include: typeof cartInclude }>;
export type CartLineRecord = CartWithItems['items'][number];

/** Unit price in CNY for a cart line: base price plus the variant's delta. */
export const unitPriceCny = (l: CartLineRecord) => l.product.priceCny.add(l.variant?.priceDeltaCny ?? 0);
/** Units currently available for a cart line (variant stock when a variant is chosen). */
export const availableStock = (l: CartLineRecord) => (l.variant ? l.variant.stock : l.product.stock);
/** Returns a reason when the line can no longer be bought as-is, otherwise null. */
export function lineIssue(l: CartLineRecord): { code: string; message: string } | null {
  if (l.product.status !== ProductStatus.ACTIVE) return { code: 'UNAVAILABLE', message: `"${l.product.name}" is no longer available` };
  if (l.variant && !l.variant.isActive) return { code: 'UNAVAILABLE', message: `The selected option of "${l.product.name}" is no longer available` };
  const stock = availableStock(l);
  if (stock <= 0) return { code: 'OUT_OF_STOCK', message: `"${l.product.name}" is out of stock` };
  if (l.quantity > stock) return { code: 'INSUFFICIENT_STOCK', message: `Only ${stock} of "${l.product.name}" available` };
  return null;
}

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  async getCartRecord(userId: string): Promise<CartWithItems> {
    const cart = await this.prisma.cart.upsert({ where: { userId }, update: {}, create: { userId }, include: cartInclude });
    return cart;
  }

  async view(userId: string, currency?: string) {
    const [cart, conv] = await Promise.all([this.getCartRecord(userId), this.pricing.converter(currency)]);
    return this.present(cart, conv);
  }

  async addItem(userId: string, productId: string, variantId: string | undefined, quantity: number) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, status: ProductStatus.ACTIVE },
      include: { variants: { where: { isActive: true } } },
    });
    if (!product) throw new NotFoundException('Product not found');

    let variantStock: number | null = null;
    if (product.variants.length > 0) {
      if (!variantId) throw new BadRequestException('Please select a size/colour option for this product');
      const v = product.variants.find((x) => x.id === variantId);
      if (!v) throw new BadRequestException('Selected option does not belong to this product');
      variantStock = v.stock;
    } else if (variantId) {
      throw new BadRequestException('This product has no options');
    }
    const stock = variantStock ?? product.stock;

    const cart = await this.prisma.cart.upsert({ where: { userId }, update: {}, create: { userId } });
    const key = { cartId: cart.id, productId, variantId: variantId ?? null };
    const existing = await this.prisma.cartItem.findFirst({ where: key });
    const newQty = (existing?.quantity ?? 0) + quantity;
    this.assertQuantity(newQty, stock);

    try {
      if (existing) await this.prisma.cartItem.update({ where: { id: existing.id }, data: { quantity: newQty } });
      else await this.prisma.cartItem.create({ data: { ...key, quantity } });
    } catch (e) {
      // A concurrent identical add hit the unique index: treat it as a conflict the client can retry.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Cart was modified, please retry');
      throw e;
    }
    return this.view(userId);
  }

  async setQuantity(userId: string, itemId: string, quantity: number) {
    const item = await this.prisma.cartItem.findFirst({ where: { id: itemId, cart: { userId } }, include: { product: true, variant: true } });
    if (!item) throw new NotFoundException('Cart item not found');
    this.assertQuantity(quantity, item.variant ? item.variant.stock : item.product.stock);
    await this.prisma.cartItem.update({ where: { id: itemId }, data: { quantity } });
    return this.view(userId);
  }

  async removeItem(userId: string, itemId: string) {
    const { count } = await this.prisma.cartItem.deleteMany({ where: { id: itemId, cart: { userId } } });
    if (count === 0) throw new NotFoundException('Cart item not found');
    return this.view(userId);
  }

  async clear(userId: string) {
    await this.prisma.cartItem.deleteMany({ where: { cart: { userId } } });
  }

  private assertQuantity(qty: number, stock: number) {
    if (qty > MAX_LINE_QUANTITY) throw new BadRequestException(`You can order at most ${MAX_LINE_QUANTITY} of one item`);
    if (qty > stock) throw new ConflictException(stock > 0 ? `Only ${stock} in stock` : 'This item is out of stock');
  }

  private present(cart: CartWithItems, conv: Converter | null) {
    let subtotalCny = new Prisma.Decimal(0);
    const items = cart.items.map((l) => {
      const unit = unitPriceCny(l);
      const lineCny = unit.mul(l.quantity);
      subtotalCny = subtotalCny.add(lineCny);
      const unitDisplay = conv ? conv.convertDecimal(unit) : null;
      return {
        id: l.id,
        productId: l.productId,
        variantId: l.variantId,
        name: l.product.name,
        slug: l.product.slug,
        sku: l.variant?.sku ?? l.product.sku,
        size: l.variant?.size ?? null,
        color: l.variant?.color ?? null,
        image: l.product.images[0] ?? null,
        quantity: l.quantity,
        unitPriceCny: unit.toFixed(2),
        lineTotalCny: lineCny.toFixed(2),
        unitPrice: unitDisplay && conv ? conv.format(unitDisplay) : null,
        lineTotal: unitDisplay && conv ? conv.format(unitDisplay.mul(l.quantity)) : null,
        available: availableStock(l),
        issue: lineIssue(l),
      };
    });
    const subtotalDisplay = conv ? items.reduce((s, i) => s.add(i.lineTotal!.amount), new Prisma.Decimal(0)) : null;
    return {
      items,
      itemCount: cart.items.reduce((n, l) => n + l.quantity, 0),
      subtotalCny: subtotalCny.toFixed(2),
      subtotal: conv && subtotalDisplay ? conv.format(subtotalDisplay) : null,
      currency: conv?.currency ?? null,
    };
  }
}
