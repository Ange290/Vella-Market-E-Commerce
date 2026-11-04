import { Module } from '@nestjs/common';
import { ReviewsController } from '../reviews/reviews.controller';
import { WishlistController } from '../wishlist/wishlist.controller';
import { CategoriesController } from './categories.controller';
import { AdminProductsController, ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { SuppliersController } from './suppliers.controller';
import { UploadsService } from './uploads.service';

@Module({
  controllers: [
    CategoriesController,
    SuppliersController,
    ProductsController,
    AdminProductsController,
    ReviewsController,
    WishlistController,
  ],
  providers: [ProductsService, UploadsService],
  exports: [ProductsService],
})
export class CatalogModule {}
