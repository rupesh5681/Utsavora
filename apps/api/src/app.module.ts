import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { CONFIG, type AppConfig } from './config';
import { DbModule } from './common/db.module';
import { CommonModule } from './common/common.module';
import { AllExceptionsFilter } from './common/exception.filter';
import { EnvelopeInterceptor } from './common/envelope.interceptor';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './auth/auth.guard';
import { CatalogModule } from './catalog/catalog.module';
import { VendorModule } from './vendor/vendor.module';
import { QuotesModule } from './quotes/quotes.module';
import { OrdersModule } from './orders/orders.module';
import { AdminModule } from './admin/admin.module';
import { NotificationsController } from './notifications/notifications.controller';
import { HealthController } from './health/health.controller';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        { module: class ConfigModule {}, global: true, providers: [{ provide: CONFIG, useValue: config }], exports: [CONFIG] },
        ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }] }),
        DbModule,
        CommonModule,
        AuthModule,
        CatalogModule,
        OrdersModule,
        QuotesModule,
        VendorModule,
        AdminModule,
      ],
      controllers: [NotificationsController, HealthController],
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    };
  }
}
