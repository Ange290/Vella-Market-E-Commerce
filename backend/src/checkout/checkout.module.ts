import { Module } from '@nestjs/common';
import { CartController } from '../cart/cart.controller';
import { CartService } from '../cart/cart.service';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';

@Module({
  controllers: [CartController, CheckoutController],
  providers: [CartService, CheckoutService],
  exports: [CartService, CheckoutService],
})
export class CheckoutModule {}
