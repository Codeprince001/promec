import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { QueueService } from '../../infra/queue.service';
import { PrismaService } from '../../prisma/prisma.service';
import { renderNotice, sendResend, sendTermii } from './channels';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly config: ConfigService,
  ) {}

  async enqueue(input: {
    userId?: string | null;
    to?: string | null;
    channel: 'email' | 'sms' | 'whatsapp';
    template: string;
    payload: Prisma.InputJsonValue;
  }) {
    const notification = await this.prisma.notification.create({
      data: {
        userId: input.userId ?? undefined,
        channel: input.channel,
        template: input.template,
        payload: { ...(typeof input.payload === 'object' && input.payload && !Array.isArray(input.payload) ? input.payload : {}), to: input.to ?? undefined },
      },
    });
    await this.queue.add('notification.send', { notificationId: notification.id });
    return notification;
  }

  async dispatch(id: string) {
    const row = await this.prisma.notification.findUnique({ where: { id } });
    if (!row || row.status === 'sent') return;
    const payload = asRecord(row.payload);
    const notice = renderNotice(row.template, payload);
    try {
      const destination = await this.destination(row.userId, payload, row.channel);
      if (!destination) throw new Error('No destination for this notification');
      if (row.channel === 'email') {
        const apiKey = this.config.get<string>('RESEND_API_KEY') ?? '';
        if (!apiKey) throw new PermanentDeliveryError('RESEND_API_KEY is not set');
        await sendResend({
          apiKey,
          from: this.config.get<string>('RESEND_FROM') ?? 'PROMEC <notifications@promec.test>',
          to: destination,
          subject: notice.subject,
          text: notice.text,
          idempotencyKey: row.id,
        });
      } else {
        const apiKey = this.config.get<string>('TERMII_API_KEY') ?? '';
        if (!apiKey) throw new PermanentDeliveryError('TERMII_API_KEY is not set');
        await sendTermii({
          apiKey,
          sender: this.config.get<string>('TERMII_SENDER') ?? 'PROMEC',
          to: destination,
          text: notice.text,
          channel: row.channel === 'whatsapp' ? 'whatsapp' : 'sms',
        });
      }
      await this.prisma.notification.update({ where: { id }, data: { status: 'sent', sentAt: new Date(), lastError: null } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const permanent = error instanceof PermanentDeliveryError || row.attempts + 1 >= 5;
      await this.prisma.notification.update({
        where: { id },
        data: { status: permanent ? 'failed' : 'queued', attempts: { increment: 1 }, lastError: message },
      });
      if (!permanent) throw error;
      this.logger.warn(`Notification ${id} was not sent: ${message}`);
    }
  }

  async dispatchQueued() {
    if (!this.prisma.ready) return 0;
    const rows = await this.prisma.notification.findMany({
      where: { status: 'queued', attempts: { lt: 5 } },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });
    for (const row of rows) {
      await this.dispatch(row.id).catch((error) => this.logger.warn(String(error)));
    }
    return rows.length;
  }

  private async destination(userId: string | null, payload: Record<string, unknown>, channel: string) {
    const direct = typeof payload.to === 'string' ? payload.to : '';
    if (direct) return direct;
    if (!userId) return '';
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return '';
    return channel === 'email' ? (user.email ?? '') : (user.phone ?? '');
  }
}

function asRecord(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

class PermanentDeliveryError extends Error {}
