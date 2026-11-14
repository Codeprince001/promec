import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../../infra/queue.service';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  async enqueue(input: { userId?: string | null; channel: 'email' | 'sms' | 'whatsapp'; template: string; payload: Prisma.InputJsonValue }) {
    const notification = await this.prisma.notification.create({
      data: {
        userId: input.userId ?? undefined,
        channel: input.channel,
        template: input.template,
        payload: input.payload,
      },
    });
    await this.queue.add('notification.send', { notificationId: notification.id });
    return notification;
  }

  async markSent(notificationId: string) {
    await this.prisma.notification.update({
      where: { id: notificationId },
      data: { status: 'sent', sentAt: new Date() },
    });
  }
}
