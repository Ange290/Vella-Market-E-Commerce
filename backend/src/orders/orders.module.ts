import { Module } from '@nestjs/common';
import { CheckoutModule } from '../checkout/checkout.module';
import { NotificationsController } from './notifications.controller';
import { AdminOrdersController, OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [CheckoutModule],
  controllers: [OrdersController, AdminOrdersController, NotificationsController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
