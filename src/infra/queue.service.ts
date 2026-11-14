import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

type JobHandler = (data: Record<string, unknown>) => Promise<void>;

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly handlers = new Map<string, JobHandler>();
  private connection?: IORedis;
  private queue?: Queue;
  private worker?: Worker;

  constructor(private readonly config: ConfigService) {}

  register(name: string, handler: JobHandler) {
    this.handlers.set(name, handler);
  }

  async add(name: string, data: Record<string, unknown>) {
    if (this.queue) {
      await this.queue.add(name, data, {
        removeOnComplete: 200,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      });
      return;
    }
    setImmediate(() => {
      void this.handlers.get(name)?.(data).catch((error) => this.logger.error(error));
    });
  }

  async onModuleInit() {
    const url = this.config.get<string>('REDIS_URL');
    if (!url || this.config.get('NODE_ENV') === 'test') return;
    const connection = new IORedis(url, { maxRetriesPerRequest: null, lazyConnect: true });
    try {
      await connection.connect();
      this.connection = connection;
      this.queue = new Queue('promec', { connection });
      this.worker = new Worker(
        'promec',
        async (job) => {
          const handler = this.handlers.get(job.name);
          if (!handler) return;
          await handler(job.data as Record<string, unknown>);
        },
        { connection },
      );
      this.logger.log('Background jobs are using Redis');
    } catch (error) {
      await connection.quit().catch(() => undefined);
      this.logger.warn(`Redis is unavailable. Jobs will run in-process. ${String(error)}`);
    }
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
    await this.connection?.quit();
  }
}
