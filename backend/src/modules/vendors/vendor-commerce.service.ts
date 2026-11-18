import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApiException } from '../../common/api.exception';
import { commissionAmount } from '../../domain/commerce';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

type Tx = Prisma.TransactionClient;

@Injectable()
export class VendorCommerceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async reserve(tx: Tx, vendorId: string, skuId: string, qty: number, orderItemId: string) {
    const updated = await tx.$executeRaw`
      UPDATE vendor_stock
      SET reserved_qty = reserved_qty + ${qty}
      WHERE vendor_id = ${vendorId}
        AND sku_id = ${skuId}
        AND (on_hand_qty - reserved_qty) >= ${qty}
    `;
    if (Number(updated) !== 1) throw new ApiException(HttpStatus.CONFLICT, 'OUT_OF_STOCK', 'The vendor does not have enough stock');
    await tx.vendorReservation.create({
      data: { vendorId, skuId, orderItemId, qty, expiresAt: new Date(Date.now() + 30 * 60_000) },
    });
  }

  async release(tx: Tx, orderItemId: string) {
    const rows = await tx.vendorReservation.findMany({ where: { orderItemId, status: 'active' } });
    for (const row of rows) {
      await tx.$executeRaw`
        UPDATE vendor_stock
        SET reserved_qty = GREATEST(reserved_qty - ${row.qty}, 0)
        WHERE vendor_id = ${row.vendorId} AND sku_id = ${row.skuId}
      `;
      await tx.vendorReservation.update({ where: { id: row.id }, data: { status: 'released' } });
    }
  }

  async commit(tx: Tx, orderItemId: string) {
    const rows = await tx.vendorReservation.findMany({ where: { orderItemId, status: 'active' } });
    for (const row of rows) {
      const updated = await tx.$executeRaw`
        UPDATE vendor_stock
        SET on_hand_qty = on_hand_qty - ${row.qty},
            reserved_qty = GREATEST(reserved_qty - ${row.qty}, 0)
        WHERE vendor_id = ${row.vendorId}
          AND sku_id = ${row.skuId}
          AND on_hand_qty >= ${row.qty}
      `;
      if (Number(updated) !== 1) throw new ApiException(HttpStatus.CONFLICT, 'INSUFFICIENT_STOCK', 'Vendor stock changed before dispatch');
      await tx.vendorReservation.update({ where: { id: row.id }, data: { status: 'committed' } });
    }
  }

  async accrue(tx: Tx, orderId: string) {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { sku: { include: { product: { include: { vendor: true } } } } } } },
    });
    if (!order) return;
    const totals = new Map<string, { merchandise: number; rate: number }>();
    for (const item of order.items) {
      const vendor = item.sku.product.vendor;
      if (!vendor || vendor.status !== 'approved') continue;
      const current = totals.get(vendor.id) ?? { merchandise: 0, rate: Number(vendor.commissionRate) };
      current.merchandise += Number(item.unitPrice) * item.qty;
      totals.set(vendor.id, current);
    }
    for (const [vendorId, total] of totals) {
      const existing = await tx.vendorLedger.findFirst({ where: { orderId, vendorId, kind: 'commission' } });
      if (existing) continue;
      await tx.vendorLedger.create({
        data: { vendorId, orderId, kind: 'commission', amount: commissionAmount(total.merchandise, total.rate) },
      });
    }
  }

  async reverse(tx: Tx, orderId: string) {
    const commissions = await tx.vendorLedger.findMany({ where: { orderId, kind: 'commission' } });
    for (const entry of commissions) {
      const existing = await tx.vendorLedger.findFirst({ where: { orderId, vendorId: entry.vendorId, kind: 'reversal' } });
      if (existing) continue;
      await tx.vendorLedger.create({
        data: { vendorId: entry.vendorId, orderId, kind: 'reversal', amount: -Number(entry.amount) },
      });
    }
  }

  async balance(vendorId: string) {
    const rows = await this.prisma.vendorLedger.findMany({ where: { vendorId } });
    return rows.reduce((sum, row) => sum + Number(row.amount), 0);
  }

  async payout(vendorId: string, amount: number, reference: string, actorId: string) {
    const vendor = await this.prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Vendor was not found');
    const open = await this.balance(vendorId);
    if (amount > open + 0.001) throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'Payout is higher than the unpaid commission');
    const entry = await this.prisma.vendorLedger.create({
      data: { vendorId, kind: 'payout', amount: -amount, reference },
    });
    await this.audit.log({ actorId, action: 'vendor.payout', entityType: 'vendor', entityId: vendorId, after: { amount, reference } });
    return entry;
  }

  async expireReservations() {
    if (!this.prisma.ready) return 0;
    const stale = await this.prisma.vendorReservation.findMany({
      where: { status: 'active', expiresAt: { lt: new Date() } },
      take: 100,
    });
    for (const row of stale) {
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          UPDATE vendor_stock
          SET reserved_qty = GREATEST(reserved_qty - ${row.qty}, 0)
          WHERE vendor_id = ${row.vendorId} AND sku_id = ${row.skuId}
        `;
        await tx.vendorReservation.update({ where: { id: row.id }, data: { status: 'expired' } });
      });
    }
    return stale.length;
  }
}
