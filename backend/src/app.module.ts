import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from './audit/audit.service';
import { AuthModule } from './auth/auth.module';
import { CatalogModule } from './catalog/catalog.module';
import { CheckoutModule } from './checkout/checkout.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { ShipmentsModule } from './shipments/shipments.module';
import { SourcingModule } from './sourcing/sourcing.module';
import { AdminModule } from './admin/admin.module';
import { ContentModule } from './content/content.module';
import { PricingModule } from './pricing/pricing.service';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { validateEnv } from './config/env.validation';
import { HealthController } from './health/health.controller';
import { MailModule } from './mail/mail.service';
import { PrismaModule } from './prisma/prisma.module';
import { SmsModule } from './sms/sms.service';
import { UsersModule } from './users/users.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // Rate limiting is disabled only under the automated test runner (NODE_ENV=test).
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
      skipIf: () => process.env.NODE_ENV === 'test',
    }),
    PrismaModule,
    AuditModule,
    MailModule,
    SmsModule,
    PricingModule,
    AuthModule,
    UsersModule,
    CatalogModule,
    CheckoutModule,
    OrdersModule,
    PaymentsModule,
    ShipmentsModule,
    SourcingModule,
    AdminModule,
    ContentModule,
  ],
  controllers: [HealthController],
  providers: [
    // Order matters: throttle → authenticate → authorise.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
