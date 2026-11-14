import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type OutboxHandler = (payload: Prisma.JsonObject) => Promise<void>;

@Injectable()
export class OutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxService.name);
  private readonly handlers = new Map<string, OutboxHandler>();
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  register(eventType: string, handler: OutboxHandler) {
    this.handlers.set(eventType, handler);
  }

  append(
    tx: Prisma.TransactionClient,
    event: { aggregateType: string; aggregateId: string; eventType: string; payload: Prisma.InputJsonValue },
  ) {
    return tx.outboxEvent.create({ data: event });
  }

  onModuleInit() {
    if (this.config.get('NODE_ENV') === 'test') return;
    this.timer = setInterval(() => {
      void this.dispatchPending();
    }, 5_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async dispatchPending() {
    if (this.running || !this.prisma.ready) return;
    this.running = true;
    try {
      const events = await this.prisma.outboxEvent.findMany({
        where: { OR: [{ status: 'pending' }, { status: 'failed', attempts: { lt: 5 } }] },
        orderBy: { createdAt: 'asc' },
        take: 50,
      });
      for (const event of events) {
        const handler = this.handlers.get(event.eventType);
        if (!handler) continue;
        try {
          const payload = event.payload;
          if (!payload || typeof payload !== 'object' || Array.isArray(payload)) continue;
          await handler(payload);
          await this.prisma.outboxEvent.update({
            where: { id: event.id },
            data: { status: 'processed', processedAt: new Date(), lastError: null },
          });
        } catch (error) {
          await this.prisma.outboxEvent.update({
            where: { id: event.id },
            data: {
              status: 'failed',
              attempts: { increment: 1 },
              lastError: error instanceof Error ? error.message : String(error),
            },
          });
          this.logger.warn(`Outbox ${event.eventType} failed: ${String(error)}`);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
