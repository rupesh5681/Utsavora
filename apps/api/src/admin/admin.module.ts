import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { QuotesModule } from '../quotes/quotes.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({ imports: [OrdersModule, QuotesModule], controllers: [AdminController], providers: [AdminService] })
export class AdminModule {}
