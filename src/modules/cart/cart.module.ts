import { Module } from '@nestjs/common';
import { CompatibilityModule } from '../compatibility/compatibility.module';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';

@Module({
  imports: [CompatibilityModule],
  controllers: [CartController],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
