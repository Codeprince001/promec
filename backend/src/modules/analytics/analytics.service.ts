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

  async dashboard(days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const [orders, paid, tickets, trackedSkus, lowStock, returns, shipments, byStatus, byPayment, daily, recent] = await Promise.all([
      this.prisma.order.count(),
      this.prisma.order.aggregate({ where: { paymentStatus: 'paid' }, _sum: { grandTotal: true }, _count: true }),
      this.prisma.supportTicket.count({ where: { status: { in: ['open', 'pending'] } } }),
      this.prisma.inventory.count(),
      this.prisma.$queryRaw<Array<{ total: number }>>`
        SELECT COUNT(*)::int AS total
        FROM inventory
        WHERE (on_hand_qty - reserved_qty) <= reorder_point
      `,
      this.prisma.returnRequest.count({ where: { status: { in: ['requested', 'approved', 'received', 'inspected'] } } }),
      this.prisma.shipment.count({ where: { status: { notIn: ['delivered', 'cancelled'] } } }),
      this.prisma.order.groupBy({ by: ['status'], _count: { _all: true }, _sum: { grandTotal: true } }),
      this.prisma.order.groupBy({ by: ['paymentStatus'], _count: { _all: true } }),
      this.prisma.$queryRaw<Array<{ day: string; orders: number; gmv: Prisma.Decimal }>>`
        SELECT to_char((placed_at AT TIME ZONE 'Africa/Lagos')::date, 'YYYY-MM-DD') AS day,
               COUNT(*)::int AS orders,
               COALESCE(SUM(grand_total) FILTER (WHERE payment_status = 'paid'), 0) AS gmv
        FROM orders
        WHERE placed_at >= ${since}
        GROUP BY 1
        ORDER BY 1
      `,
      this.prisma.order.findMany({
        orderBy: { placedAt: 'desc' },
        take: 8,
        select: { id: true, orderNo: true, status: true, paymentStatus: true, grandTotal: true, placedAt: true },
      }),
    ]);

    const gmv = Number(paid._sum.grandTotal ?? 0);
    const byDay = new Map(daily.map((row) => [String(row.day).slice(0, 10), { orders: Number(row.orders), gmv: Number(row.gmv) }]));
    const revenue = fillDays(days, byDay);

    return {
      orders,
      paidOrders: paid._count,
      gmv: gmv.toFixed(2),
      currency: 'NGN',
      averageOrder: (paid._count ? gmv / paid._count : 0).toFixed(2),
      openTickets: tickets,
      lowStockSkus: Number(lowStock[0]?.total ?? 0),
      trackedSkus,
      openReturns: returns,
      openShipments: shipments,
      days,
      revenue,
      byStatus: byStatus
        .map((row) => ({ status: row.status, count: row._count._all, amount: Number(row._sum.grandTotal ?? 0).toFixed(2) }))
        .sort((a, b) => b.count - a.count),
      byPayment: byPayment
        .map((row) => ({ status: row.paymentStatus, count: row._count._all }))
        .sort((a, b) => b.count - a.count),
      recent: recent.map((row) => ({
        id: row.id,
        orderNo: row.orderNo,
        status: row.status,
        paymentStatus: row.paymentStatus,
        grandTotal: Number(row.grandTotal).toFixed(2),
        placedAt: row.placedAt.toISOString(),
      })),
    };
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

function fillDays(days: number, byDay: Map<string, { orders: number; gmv: number }>) {
  const points: { date: string; orders: number; gmv: string }[] = [];
  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date(Date.now() - index * 24 * 60 * 60 * 1000));
    const point = byDay.get(date) ?? { orders: 0, gmv: 0 };
    points.push({ date, orders: point.orders, gmv: point.gmv.toFixed(2) });
  }
  return points;
}
