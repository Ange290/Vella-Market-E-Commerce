import { Module } from '@nestjs/common';
import { AdminContentController, PublicContentController } from './content.controller';

@Module({ controllers: [PublicContentController, AdminContentController] })
export class ContentModule {}
