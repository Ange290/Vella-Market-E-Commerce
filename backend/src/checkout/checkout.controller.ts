import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DeliveryMethod } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { CheckoutService } from './checkout.service';

const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);

export class QuoteDto {
  @IsString() addressId!: string;
  @IsEnum(DeliveryMethod) deliveryMethod!: DeliveryMethod;
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{3}$/) currency?: string;
  @IsOptional() @Transform(upper) @IsString() @MaxLength(30) couponCode?: string;
}

class ShippingOptionsQuery {
  @IsString() addressId!: string;
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{3}$/) currency?: string;
}

@ApiTags('Checkout')
@ApiBearerAuth()
@Controller('checkout')
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  @Get('shipping-options')
  @ApiOperation({ summary: 'Delivery methods and prices for the current cart and a delivery address' })
  options(@Query() q: ShippingOptionsQuery, @CurrentUser() user: AuthUser) {
    return this.checkout.shippingOptions(user.id, q.addressId, q.currency);
  }

  @Post('quote')
  @HttpCode(200)
  @ApiOperation({ summary: 'Itemised price breakdown: subtotal, shipping, service fee, taxes, discount, total' })
  quote(@Body() dto: QuoteDto, @CurrentUser() user: AuthUser) {
    return this.checkout.quote(user.id, dto);
  }
}
