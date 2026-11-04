import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DashboardController } from './dashboard.controller';
import { PeopleController } from './people.controller';
import { SystemAdminController } from './system.controller';

@Module({ imports: [AuthModule], controllers: [DashboardController, PeopleController, SystemAdminController] })
export class AdminModule {}
