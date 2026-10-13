import { Module } from '@nestjs/common';
import { QuotesModule } from '../quotes/quotes.module';
import { VendorController } from './vendor.controller';
import { VendorService } from './vendor.service';

@Module({ imports: [QuotesModule], controllers: [VendorController], providers: [VendorService], exports: [VendorService] })
export class VendorModule {}
