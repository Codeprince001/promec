import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { PaystackModule } from './paystack.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [OrdersModule, PaystackModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
