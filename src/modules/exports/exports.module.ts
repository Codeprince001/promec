import { Controller, Get, Module, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { money } from '../../common/money';
import { PrismaService } from '../../prisma/prisma.service';

const range = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

function window(query: { from?: string; to?: string }) {
  return {
    gte: query.from ? new Date(query.from) : new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
    lte: query.to ? new Date(query.to) : new Date(),
  };
}

function csv(headers: string[], rows: Array<Array<string | number>>) {
  const escape = (value: string | number) => {
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [headers.join(','), ...rows.map((row) => row.map(escape).join(','))].join('\n');
}

@ApiTags('exports')
@Controller('admin/exports')
export class ExportsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('orders')
  @Permissions('analytics.view')
  async orders(@Query({ schema: range }) query: z.infer<typeof range>) {
    const rows = await this.prisma.order.findMany({
      where: { placedAt: window(query) },
      orderBy: { placedAt: 'asc' },
    });
    return {
      filename: 'orders.csv',
      csv: csv(
        ['orderNo', 'placedAt', 'status', 'paymentStatus', 'subtotal', 'discount', 'shipping', 'tax', 'grandTotal', 'currency'],
        rows.map((row) => [row.orderNo, row.placedAt.toISOString(), row.status, row.paymentStatus, money(row.subtotal), money(row.discountTotal), money(row.shippingTotal), money(row.taxTotal), money(row.grandTotal), row.currencyCode]),
      ),
    };
  }

  @Get('payments')
  @Permissions('payments.manage')
  async payments(@Query({ schema: range }) query: z.infer<typeof range>) {
    const rows = await this.prisma.payment.findMany({
      where: { createdAt: window(query) },
      include: { order: { select: { orderNo: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return {
      filename: 'payments.csv',
      csv: csv(
        ['reference', 'orderNo', 'provider', 'method', 'status', 'amount', 'currency', 'createdAt'],
        rows.map((row) => [row.providerRef, row.order.orderNo, row.provider, row.method, row.status, money(row.amount), row.currency, row.createdAt.toISOString()]),
      ),
    };
  }

  @Get('tax')
  @Permissions('analytics.view')
  async tax(@Query({ schema: range }) query: z.infer<typeof range>) {
    const rows = await this.prisma.order.findMany({
      where: { placedAt: window(query), paymentStatus: 'paid' },
      orderBy: { placedAt: 'asc' },
    });
    const tax = rows.reduce((sum, row) => sum + Number(row.taxTotal), 0);
    return {
      filename: 'tax.csv',
      total: tax.toFixed(2),
      csv: csv(
        ['orderNo', 'placedAt', 'tax', 'grandTotal', 'currency'],
        rows.map((row) => [row.orderNo, row.placedAt.toISOString(), money(row.taxTotal), money(row.grandTotal), row.currencyCode]),
      ),
    };
  }

  @Get('vendors/:id/ledger')
  @Permissions('vendors.manage')
  async ledger(@Param('id') id: string) {
    const rows = await this.prisma.vendorLedger.findMany({ where: { vendorId: id }, orderBy: { createdAt: 'asc' } });
    return {
      filename: 'vendor-ledger.csv',
      csv: csv(
        ['createdAt', 'kind', 'amount', 'reference'],
        rows.map((row) => [row.createdAt.toISOString(), row.kind, money(row.amount), row.reference ?? '']),
      ),
    };
  }
}

@Module({ controllers: [ExportsController] })
export class ExportsModule {}
