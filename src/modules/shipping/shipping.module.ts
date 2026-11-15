import { Module } from '@nestjs/common';
import { ShippingAdminController, ShippingController } from './shipping.controller';
import { CarrierGateway } from './couriers/carriers';
import { ShippingService } from './shipping.service';

@Module({
  controllers: [ShippingController, ShippingAdminController],
  providers: [ShippingService, CarrierGateway],
  exports: [ShippingService],
})
export class ShippingModule {}
