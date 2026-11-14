import { Module } from '@nestjs/common';
import { GarageController, VehiclesController } from './vehicles.controller';
import { VehiclesService } from './vehicles.service';

@Module({
  controllers: [VehiclesController, GarageController],
  providers: [VehiclesService],
  exports: [VehiclesService],
})
export class VehiclesModule {}
