import { Module } from '@nestjs/common';
import { CartModule } from '../cart/cart.module';
import { CompatibilityModule } from '../compatibility/compatibility.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { PaystackModule } from '../payments/paystack.module';
import { ShippingModule } from '../shipping/shipping.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [CartModule, CompatibilityModule, InventoryModule, ShippingModule, PromotionsModule, PaystackModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
