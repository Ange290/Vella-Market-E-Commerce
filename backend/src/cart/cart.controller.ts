import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { CartService, MAX_LINE_QUANTITY } from './cart.service';

class AddCartItemDto {
  @IsString() productId!: string;
  @IsOptional() @IsString() variantId?: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(MAX_LINE_QUANTITY) quantity!: number;
}
class UpdateCartItemDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(MAX_LINE_QUANTITY) quantity!: number;
}

@ApiTags('Cart')
@ApiBearerAuth()
@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  @ApiOperation({ summary: 'Current cart with line totals (converted when ?currency= has a configured rate)' })
  view(@CurrentUser() user: AuthUser, @Query('currency') currency?: string) {
    return this.cart.view(user.id, currency);
  }

  @Post('items')
  @ApiOperation({ summary: 'Add a product (or increase its quantity). Products with options need variantId.' })
  add(@Body() dto: AddCartItemDto, @CurrentUser() user: AuthUser) {
    return this.cart.addItem(user.id, dto.productId, dto.variantId, dto.quantity);
  }

  @Patch('items/:id')
  update(@Param('id') id: string, @Body() dto: UpdateCartItemDto, @CurrentUser() user: AuthUser) {
    return this.cart.setQuantity(user.id, id, dto.quantity);
  }

  @Delete('items/:id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.cart.removeItem(user.id, id);
  }

  @Delete()
  @HttpCode(204)
  async clear(@CurrentUser() user: AuthUser) {
    await this.cart.clear(user.id);
  }
}
