import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async record(kind: 'sale' | 'fitment' | 'purchase', amount: number, dimensions: Prisma.InputJsonObject) {
    await this.prisma.analyticsEvent.create({
      data: { kind, amount, currency: 'NGN', dimensions },
    });
  }

  async history(kind: 'sale' | 'fitment' | 'purchase', days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.analyticsEvent.findMany({
      where: { kind, occurredAt: { gte: since } },
      orderBy: { occurredAt: 'asc' },
    });
    const daysByKey = new Map<string, { date: string; count: number; amount: number }>();
    for (const row of rows) {
      const date = row.occurredAt.toISOString().slice(0, 10);
      const current = daysByKey.get(date) ?? { date, count: 0, amount: 0 };
      current.count += 1;
      current.amount += Number(row.amount);
      daysByKey.set(date, current);
    }
    return {
      kind,
      days,
      total: rows.length,
      amount: rows.reduce((sum, row) => sum + Number(row.amount), 0).toFixed(2),
      series: [...daysByKey.values()].map((point) => ({ ...point, amount: point.amount.toFixed(2) })),
    };
  }
}
