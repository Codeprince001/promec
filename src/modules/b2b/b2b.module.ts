import { Module } from '@nestjs/common';
import { B2bController } from './b2b.controller';
import { CreditService } from './credit.service';

@Module({
  controllers: [B2bController],
  providers: [CreditService],
  exports: [CreditService],
})
export class B2bModule {}
