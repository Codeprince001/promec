import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  ready = false;

  constructor(config: ConfigService) {
    const adapter = new PrismaPg({
      connectionString: config.get<string>('DATABASE_URL') ?? 'postgresql://postgres:promec@localhost:5432/promec',
    });
    super({ adapter });
  }

  async onModuleInit() {
    try {
      await this.$connect();
      this.ready = true;
    } catch (error) {
      this.ready = false;
      this.logger.warn(`Database is not reachable. Start Postgres, then run npm run db:migrate. ${String(error)}`);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
