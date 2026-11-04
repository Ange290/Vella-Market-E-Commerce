import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { memoryStorage } from 'multer';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AdminListProductsQuery, CreateProductDto, ListProductsQuery, UpdateProductDto, UpdateVariantDto, VariantInputDto } from './dto';
import { ProductsService } from './products.service';
import { UploadsService } from './uploads.service';

@ApiTags('Products')
@Controller()
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Public()
  @Get('products')
  @ApiOperation({ summary: 'Search, filter, sort and paginate products' })
  list(@Query() q: ListProductsQuery) {
    return this.products.list(q);
  }

  @Public()
  @Get('products/:slug')
  @ApiOperation({ summary: 'Product details with images, variants, sizes, colours and supplier summary' })
  detail(@Param('slug') slug: string, @Query('currency') currency?: string) {
    return this.products.detail(slug, currency);
  }

  @Public()
  @Get('products/:slug/related')
  related(@Param('slug') slug: string, @Query('currency') currency?: string) {
    return this.products.related(slug, currency);
  }
}

@ApiTags('Admin · Products')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.STAFF)
@Controller('admin')
export class AdminProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly uploads: UploadsService,
    private readonly audit: AuditService,
  ) {}

  @Get('products')
  list(@Query() q: AdminListProductsQuery) {
    return this.products.adminList(q);
  }

  @Get('products/:id')
  get(@Param('id') id: string) {
    return this.products.adminGet(id);
  }

  @Post('products')
  async create(@Body() dto: CreateProductDto, @CurrentUser() actor: AuthUser) {
    const p = await this.products.create(dto);
    await this.audit.log({ actorId: actor.id, action: 'product.create', entity: 'Product', entityId: p.id });
    return p;
  }

  @Patch('products/:id')
  async update(@Param('id') id: string, @Body() dto: UpdateProductDto, @CurrentUser() actor: AuthUser) {
    const p = await this.products.update(id, dto);
    await this.audit.log({ actorId: actor.id, action: 'product.update', entity: 'Product', entityId: id, metadata: { fields: Object.keys(dto) } });
    return p;
  }

  @Delete('products/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Archive a product (soft delete — order history is preserved)' })
  async archive(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    await this.products.archive(id);
    await this.audit.log({ actorId: actor.id, action: 'product.archive', entity: 'Product', entityId: id });
  }

  @Post('products/:id/variants')
  addVariant(@Param('id') id: string, @Body() dto: VariantInputDto) {
    return this.products.addVariant(id, dto);
  }

  @Patch('variants/:id')
  updateVariant(@Param('id') id: string, @Body() dto: UpdateVariantDto) {
    return this.products.updateVariant(id, dto);
  }

  @Delete('variants/:id')
  @HttpCode(204)
  async deactivateVariant(@Param('id') id: string) {
    await this.products.deactivateVariant(id);
  }

  @Post('products/:id/images')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a product image (JPEG/PNG/WebP, max 5 MB)' })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  async uploadImage(@Param('id') id: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Attach an image in the "file" field');
    const url = await this.uploads.saveImage(file);
    return this.products.addImage(id, url);
  }

  @Delete('product-images/:id')
  @HttpCode(204)
  async removeImage(@Param('id') id: string) {
    await this.products.removeImage(id);
  }
}
