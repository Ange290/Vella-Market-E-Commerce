-- Integrity constraints Prisma cannot express in schema.prisma.

ALTER TABLE "Review"     ADD CONSTRAINT "Review_rating_range"      CHECK ("rating" BETWEEN 1 AND 5);
ALTER TABLE "CartItem"   ADD CONSTRAINT "CartItem_quantity_pos"    CHECK ("quantity" > 0);
ALTER TABLE "OrderItem"  ADD CONSTRAINT "OrderItem_quantity_pos"   CHECK ("quantity" > 0);
ALTER TABLE "Product"    ADD CONSTRAINT "Product_stock_nonneg"     CHECK ("stock" >= 0);
ALTER TABLE "Product"    ADD CONSTRAINT "Product_price_nonneg"     CHECK ("priceCny" >= 0);
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_stock_nonneg" CHECK ("stock" >= 0);
ALTER TABLE "Order"      ADD CONSTRAINT "Order_amounts_nonneg"     CHECK ("subtotal" >= 0 AND "shippingFee" >= 0 AND "serviceFee" >= 0 AND "taxAmount" >= 0 AND "discountAmount" >= 0 AND "total" >= 0);
ALTER TABLE "Payment"    ADD CONSTRAINT "Payment_amount_pos"       CHECK ("amount" > 0);
ALTER TABLE "Refund"     ADD CONSTRAINT "Refund_amount_pos"        CHECK ("amount" > 0);
ALTER TABLE "OTPVerification" ADD CONSTRAINT "OTP_attempts_nonneg" CHECK ("attempts" >= 0);
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_rate_pos"  CHECK ("rate" > 0);
ALTER TABLE "Coupon"     ADD CONSTRAINT "Coupon_value_pos"         CHECK ("value" > 0);

-- Cart: PostgreSQL treats NULLs as distinct, so a plain UNIQUE(cartId, productId, variantId)
-- would allow duplicate rows for products without variants.
CREATE UNIQUE INDEX "CartItem_cartId_productId_novariant_key"
  ON "CartItem" ("cartId", "productId") WHERE "variantId" IS NULL;

-- Only one default address per user.
CREATE UNIQUE INDEX "Address_userId_default_key"
  ON "Address" ("userId") WHERE "isDefault" = true;

-- Only one active (unconsumed) OTP per target + purpose.
CREATE UNIQUE INDEX "OTP_active_target_purpose_key"
  ON "OTPVerification" ("target", "purpose") WHERE "consumedAt" IS NULL;

-- Only one successful payment per order (duplicate-payment prevention at DB level).
CREATE UNIQUE INDEX "Payment_one_success_per_order_key"
  ON "Payment" ("orderId") WHERE "status" = 'SUCCESSFUL';
