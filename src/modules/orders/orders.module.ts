import { Module } from '@nestjs/common';
import { CartModule } from '../cart/cart.module';
import { CompatibilityModule } from '../compatibility/compatibility.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { B2bModule } from '../b2b/b2b.module';
import { PaystackModule } from '../payments/paystack.module';
import { ShippingModule } from '../shipping/shipping.module';
import { VendorsModule } from '../vendors/vendors.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [CartModule, CompatibilityModule, InventoryModule, ShippingModule, PromotionsModule, B2bModule, PaystackModule, VendorsModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
