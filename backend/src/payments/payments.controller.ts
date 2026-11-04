import { Body, Controller, Get, Headers, HttpCode, Inject, NotFoundException, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaymentMethod, PaymentStatus, Prisma, RefundStatus, Role } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PaginationQuery } from '../common/pagination';
import type { Env } from '../config/env.validation';
import { PAYMENT_GATEWAY, PaymentGateway } from './gateway';
import { MockGateway } from './mock.gateway';
import { PaymentsService } from './payments.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class InitiatePaymentDto {
  @IsEnum(PaymentMethod) method!: PaymentMethod;
}
class AdminListPaymentsQuery extends PaginationQuery {
  @IsOptional() @IsEnum(PaymentStatus) status?: PaymentStatus;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) search?: string;
}
class CreateRefundDto {
  @IsOptional() @Matches(/^\d{1,12}(\.\d{1,2})?$/, { message: 'amount must be a positive amount with at most 2 decimals' }) amount?: string;
  @Transform(trim) @IsString() @Length(5, 300) reason!: string;
}
class ResolveRefundDto {
  @IsIn(['COMPLETED', 'FAILED']) status!: 'COMPLETED' | 'FAILED';
}
class ListRefundsQuery extends PaginationQuery {
  @IsOptional() @IsEnum(RefundStatus) status?: RefundStatus;
}
class SimulateDto {
  @IsIn(['successful', 'failed', 'pending']) outcome!: 'successful' | 'failed' | 'pending';
  /** Override the amount the simulated provider reports (to test mismatch handling). */
  @IsOptional() @Matches(/^\d{1,12}(\.\d{1,2})?$/) amount?: string;
}

@ApiTags('Payments')
@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @ApiBearerAuth()
  @Post('orders/:orderId/payments')
  @ApiOperation({ summary: 'Start paying for an order. Amount comes from the order; returns the provider checkout link.' })
  initiate(
    @Param('orderId') orderId: string,
    @Body() dto: InitiatePaymentDto,
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.payments.initiate(user.id, orderId, dto.method, idempotencyKey?.slice(0, 100));
  }

  @ApiBearerAuth()
  @Get('payments/:reference/status')
  @ApiOperation({ summary: 'Payment status (re-verified with the provider while still open)' })
  status(@Param('reference') reference: string, @CurrentUser() user: AuthUser) {
    return this.payments.statusForCustomer(user.id, reference);
  }

  @Public()
  @Post('payments/webhooks/flutterwave')
  @HttpCode(200)
  @ApiOperation({ summary: 'Flutterwave webhook (verif-hash checked; payment is re-verified server-side before it counts)' })
  webhook(@Req() req: Request, @Body() body: unknown) {
    return this.payments.handleWebhook(req.headers, body);
  }
}

@ApiTags('Admin · Payments')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.STAFF)
@Controller('admin')
export class AdminPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('payments')
  list(@Query() q: AdminListPaymentsQuery) {
    return this.payments.adminList(q);
  }

  @Get('payments/:id')
  get(@Param('id') id: string) {
    return this.payments.adminGet(id);
  }

  @Post('payments/:id/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Re-check a payment with the provider and update our records' })
  verify(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.payments.adminVerify(id, actor.id);
  }

  @Roles(Role.ADMIN)
  @Post('payments/:id/refunds')
  @ApiOperation({ summary: 'Refund all or part of a payment (ADMIN)' })
  refund(@Param('id') id: string, @Body() dto: CreateRefundDto, @CurrentUser() actor: AuthUser) {
    return this.payments.createRefund(id, dto, actor.id);
  }

  @Get('refunds')
  refunds(@Query() q: ListRefundsQuery) {
    return this.payments.listRefunds(q);
  }

  @Roles(Role.ADMIN)
  @Patch('refunds/:id')
  @ApiOperation({ summary: 'Mark a provider-processing refund as completed or failed (ADMIN)' })
  resolve(@Param('id') id: string, @Body() dto: ResolveRefundDto, @CurrentUser() actor: AuthUser) {
    return this.payments.resolveRefund(id, dto.status, actor.id);
  }
}

/**
 * Development helper, only reachable when PAYMENT_PROVIDER=mock (never in production — the app
 * refuses to start that way). Simulates the provider's outcome and delivers a signed webhook through
 * the real handler, so the whole pipeline is exercised without keys.
 */
@ApiTags('Dev · Mock payments')
@Controller('dev/payments')
export class DevMockPaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly config: ConfigService<Env, true>,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  @Public()
  @Post(':reference/simulate')
  @HttpCode(200)
  async simulate(@Param('reference') reference: string, @Body() dto: SimulateDto) {
    if (this.config.get('NODE_ENV', { infer: true }) === 'production' || !(this.gateway instanceof MockGateway)) {
      throw new NotFoundException();
    }
    const { id } = this.gateway.simulate(reference, { status: dto.outcome, amount: dto.amount ? new Prisma.Decimal(dto.amount) : undefined });
    if (dto.outcome === 'pending') return { simulated: dto.outcome };
    await this.payments.handleWebhook(
      { 'verif-hash': this.gateway.secret },
      { event: 'charge.completed', data: { id, tx_ref: reference, status: dto.outcome } },
    );
    return { simulated: dto.outcome, webhookDelivered: true };
  }
}
