import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { OrdersModule } from '../orders/orders.module';
import { AdminSourcingController, SourcingController } from './sourcing.controller';
import { SourcingService } from './sourcing.service';

@Module({
  imports: [OrdersModule, CatalogModule],
  controllers: [SourcingController, AdminSourcingController],
  providers: [SourcingService],
})
export class SourcingModule {}
