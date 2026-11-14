import { Global, Module, OnModuleInit } from '@nestjs/common';
import { QueueService } from '../../infra/queue.service';
import { NotificationsService } from './notifications.service';

@Global()
@Module({
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule implements OnModuleInit {
  constructor(
    private readonly queue: QueueService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.queue.register('notification.send', async (data) => {
      const id = data.notificationId;
      if (typeof id === 'string') await this.notifications.markSent(id);
    });
  }
}
