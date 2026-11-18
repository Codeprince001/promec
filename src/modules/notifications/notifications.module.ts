import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Global, Module, OnModuleInit } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { QueueService } from '../../infra/queue.service';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@Controller()
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('notifications')
  mine(@CurrentUser() user: AuthUser) {
    return this.notifications.inbox(user.sub);
  }

  @Post('notifications/:id/read')
  read(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notifications.markRead(user.sub, id);
  }

  @Get('admin/notifications')
  @Permissions('users.manage')
  queue(@Query({ schema: z.object({ status: z.enum(['queued', 'failed', 'sent']).optional() }) }) query: { status?: string }) {
    return this.notifications.deliveryQueue(query.status);
  }
}

@Global()
@Module({
  controllers: [NotificationsController],
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
      if (typeof id === 'string') await this.notifications.dispatch(id);
    });
  }
}
