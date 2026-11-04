import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrdersModule } from '../orders/orders.module';
import type { Env } from '../config/env.validation';
import { FlutterwaveGateway } from './flutterwave.gateway';
import { DisabledGateway, PAYMENT_GATEWAY, PaymentGateway } from './gateway';
import { MockGateway } from './mock.gateway';
import { AdminPaymentsController, DevMockPaymentsController, PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [OrdersModule],
  controllers: [PaymentsController, AdminPaymentsController, DevMockPaymentsController],
  providers: [
    PaymentsService,
    {
      provide: PAYMENT_GATEWAY,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): PaymentGateway => {
        switch (config.get('PAYMENT_PROVIDER', { infer: true })) {
          case 'flutterwave':
            return new FlutterwaveGateway({
              baseUrl: config.get('FLUTTERWAVE_BASE_URL', { infer: true }),
              secretKey: config.get('FLUTTERWAVE_SECRET_KEY', { infer: true }),
              webhookSecretHash: config.get('FLUTTERWAVE_WEBHOOK_SECRET_HASH', { infer: true }),
            });
          case 'mock':
            return new MockGateway(config.get('FLUTTERWAVE_WEBHOOK_SECRET_HASH', { infer: true }), config.get('APP_URL', { infer: true }));
          default:
            return new DisabledGateway();
        }
      },
    },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
