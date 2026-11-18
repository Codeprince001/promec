import { Global, Module } from '@nestjs/common';
import { OutboxService } from './outbox.service';
import { QueueService } from './queue.service';
import { RateLimitService } from './rate-limit.service';

@Global()
@Module({
  providers: [QueueService, OutboxService, RateLimitService],
  exports: [QueueService, OutboxService, RateLimitService],
})
export class QueueModule {}
