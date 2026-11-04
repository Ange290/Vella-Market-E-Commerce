import { OmitType, PartialType } from '@nestjs/swagger';
import { ProductStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQuery } from '../common/pagination';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const toStr = ({ value }: { value: unknown }) => (typeof value === 'number' ? String(value) : value);
export const MONEY = /^\d{1,12}(\.\d{1,2})?$/;
const MONEY_MSG = 'must be a non-negative amount with at most 2 decimals';
const HTTP_URL = { protocols: ['http', 'https'], require_protocol: true };

// ───────── Categories ─────────
export class CreateCategoryDto {
  @Transform(trim) @IsString() @Length(2, 80) name!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsString() parentId?: string;
  @IsOptional() @IsUrl(HTTP_URL) imageUrl?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {}

// ───────── Suppliers ─────────
export class CreateSupplierDto {
  @Transform(trim) @IsString() @Length(2, 120) name!: string;
  @IsOptional() @IsString() @MaxLength(120) contactName?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @Matches(/^[A-Z]{2}$/) country?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsString() @MaxLength(60) platform?: string;
  @IsOptional() @IsUrl(HTTP_URL) website?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateSupplierDto extends PartialType(CreateSupplierDto) {}

// ───────── Products ─────────
export class ImageInputDto {
  @IsUrl(HTTP_URL) url!: string;
  @IsOptional() @IsString() @MaxLength(200) altText?: string;
}

export class VariantInputDto {
  @Transform(trim) @IsString() @Length(2, 60) sku!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(40) size?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(40) color?: string;
  /** Price difference vs. the base product price, in CNY (may be negative). */
  @IsOptional() @Transform(toStr) @Matches(/^-?\d{1,12}(\.\d{1,2})?$/) priceDeltaCny?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) stock?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateVariantDto extends PartialType(OmitType(VariantInputDto, ['sku'] as const)) {}

export class CreateProductDto {
  @Transform(trim) @IsString() @Length(2, 60) sku!: string;
  @Transform(trim) @IsString() @Length(2, 200) name!: string;
  @IsString() @Length(10, 10_000) description!: string;
  @IsString() categoryId!: string;
  @IsOptional() @IsString() supplierId?: string;
  @Transform(toStr) @Matches(MONEY, { message: `priceCny ${MONEY_MSG}` }) priceCny!: string;
  @IsOptional() @IsObject() specifications?: Record<string, string | number | boolean>;
  @IsOptional() @IsUrl(HTTP_URL) sourceUrl?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10_000_000) stock?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000) weightGrams?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365) processingDaysMin?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365) processingDaysMax?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365) shippingDaysMin?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365) shippingDaysMax?: number;
  @IsOptional() @IsEnum(ProductStatus) status?: ProductStatus;
  @IsOptional() @IsArray() @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => ImageInputDto) images?: ImageInputDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => VariantInputDto) variants?: VariantInputDto[];
}
export class UpdateProductDto extends PartialType(OmitType(CreateProductDto, ['images', 'variants'] as const)) {}

export enum ProductSort {
  NEWEST = 'newest',
  PRICE_ASC = 'price_asc',
  PRICE_DESC = 'price_desc',
  RATING = 'rating',
  NAME = 'name',
}

export class ListProductsQuery extends PaginationQuery {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
  /** Category slug; includes sub-categories. */
  @IsOptional() @IsString() @MaxLength(100) category?: string;
  /** Price filters are in CNY (the catalogue base currency). */
  @IsOptional() @Transform(toStr) @Matches(MONEY) minPrice?: string;
  @IsOptional() @Transform(toStr) @Matches(MONEY) maxPrice?: string;
  @IsOptional() @IsEnum(ProductSort) sort: ProductSort = ProductSort.NEWEST;
  /** Display currency for converted prices, e.g. RWF. */
  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value)) @Matches(/^[A-Z]{3}$/) currency?: string;
}

export class AdminListProductsQuery extends ListProductsQuery {
  @IsOptional() @IsEnum(ProductStatus) status?: ProductStatus;
}

export class ReviewDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(5) rating!: number;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) title?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) comment?: string;
}
