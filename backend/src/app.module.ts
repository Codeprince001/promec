import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { HttpStatus, UnprocessableEntityException } from '@nestjs/common';
import { StandardSchemaValidationPipe } from '@nestjs/common';
import { createObserveModule } from '@nestjs/observe';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';
import { CryptoModule } from './common/crypto/crypto.module';
import { envSchema } from './config/env';
import { MaintenanceService } from './infra/maintenance.service';
import { QueueModule } from './infra/queue.module';
import { PrismaModule } from './prisma/prisma.module';
import { AiModule } from './modules/analytics/analytics.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { B2bModule } from './modules/b2b/b2b.module';
import { CartModule } from './modules/cart/cart.module';
import { CatalogueModule } from './modules/catalogue/catalogue.module';
import { CompatibilityModule } from './modules/compatibility/compatibility.module';
import { ExportsModule } from './modules/exports/exports.module';
import { HealthModule } from './modules/health/health.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PartRequestsModule } from './modules/part-requests/part-requests.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { ProcurementModule } from './modules/procurement/procurement.module';
import { PromotionsModule } from './modules/promotions/promotions.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { SearchModule } from './modules/search/search.module';
import { SettingsModule } from './modules/settings/settings.module';
import { ShippingModule } from './modules/shipping/shipping.module';
import { SuppliersModule } from './modules/suppliers/suppliers.module';
import { SupportModule } from './modules/support/support.module';
import { UsersModule } from './modules/users/users.module';
import { VehiclesModule } from './modules/vehicles/vehicles.module';
import { VendorsModule } from './modules/vendors/vendors.module';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (env) => envSchema.parse(env),
    }),
    ObserveModule.forRoot({
      appKey: process.env.OBSERVE_APP_KEY ?? 'YOUR_APP_KEY',
      appSecret: process.env.OBSERVE_APP_SECRET ?? 'YOUR_APP_SECRET',
      serviceId: 'backend',
    }),
    PrismaModule,
    CryptoModule,
    SettingsModule,
    QueueModule,
    AuditModule,
    NotificationsModule,
    RbacModule,
    AuthModule,
    UsersModule,
    VehiclesModule,
    CatalogueModule,
    CompatibilityModule,
    SearchModule,
    CartModule,
    InventoryModule,
    ShippingModule,
    PromotionsModule,
    OrdersModule,
    PaymentsModule,
    SupportModule,
    PartRequestsModule,
    VendorsModule,
    SuppliersModule,
    ProcurementModule,
    B2bModule,
    AnalyticsModule,
    ExportsModule,
    AiModule,
    HealthModule,
  ],
  providers: [
    MaintenanceService,
    {
      provide: APP_PIPE,
      useValue: new StandardSchemaValidationPipe({
        errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        exceptionFactory: (issues) =>
          new UnprocessableEntityException({
            code: 'VALIDATION_ERROR',
            message: 'Validation failed',
            details: issues.map((issue) => ({
              field: issue.path?.map(String).join('.') || '',
              issue: issue.message,
            })),
          }),
      }),
    },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
  ],
})
export class AppModule {}
