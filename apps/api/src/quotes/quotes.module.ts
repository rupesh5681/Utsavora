import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { QuotesService } from './quotes.service';
import { RequestsController } from './requests.controller';

@Module({ imports: [OrdersModule], controllers: [RequestsController], providers: [QuotesService], exports: [QuotesService] })
export class QuotesModule {}
