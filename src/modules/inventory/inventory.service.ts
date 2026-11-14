import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApiException } from '../../common/api.exception';
import { PrismaService } from '../../prisma/prisma.service';

export type Tx = Prisma.TransactionClient;

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  list(warehouseIds: string[] | null) {
    return this.prisma.inventory.findMany({
      where: warehouseIds ? { warehouseId: { in: warehouseIds } } : undefined,
      include: { sku: { include: { product: true } }, warehouse: true },
      orderBy: { sku: { sku: 'asc' } },
    });
  }

  async adjust(skuId: string, qtyDelta: number, reason: string, userId: string, warehouseIds: string[] | null = null) {
    const warehouse = warehouseIds
      ? await this.prisma.warehouse.findFirst({ where: { id: { in: warehouseIds }, isActive: true }, orderBy: { code: 'asc' } })
      : await this.defaultWarehouse();
    if (!warehouse) throw new ApiException(HttpStatus.CONFLICT, 'NO_WAREHOUSE', 'No active warehouse is configured');
    const inventory = await this.prisma.inventory.upsert({
      where: { skuId_warehouseId: { skuId, warehouseId: warehouse.id } },
      update: {},
      create: { skuId, warehouseId: warehouse.id, onHandQty: 0 },
    });
    if (inventory.onHandQty + qtyDelta < 0) {
      throw new ApiException(HttpStatus.CONFLICT, 'INSUFFICIENT_STOCK', 'Adjustment would make stock negative');
    }
    const updated = await this.prisma.inventory.update({
      where: { id: inventory.id },
      data: {
        onHandQty: { increment: qtyDelta },
        movements: { create: { movementType: 'adjustment', qty: qtyDelta, reason, userId } },
      },
    });
    return updated;
  }

  async reserve(tx: Tx, skuId: string, qty: number) {
    const warehouse = await tx.warehouse.findFirst({ where: { isActive: true }, orderBy: { code: 'asc' } });
    if (!warehouse) throw new ApiException(HttpStatus.CONFLICT, 'NO_WAREHOUSE', 'No active warehouse is configured');
    const inventory = await tx.inventory.findUnique({
      where: { skuId_warehouseId: { skuId, warehouseId: warehouse.id } },
    });
    if (!inventory) throw new ApiException(HttpStatus.CONFLICT, 'OUT_OF_STOCK', 'This part is not in stock');
    const updated = await tx.$executeRaw`
      UPDATE inventory
      SET reserved_qty = reserved_qty + ${qty}
      WHERE id = CAST(${inventory.id} AS uuid)
        AND (on_hand_qty - reserved_qty) >= ${qty}
    `;
    if (Number(updated) !== 1) {
      throw new ApiException(HttpStatus.CONFLICT, 'OUT_OF_STOCK', 'Not enough stock to reserve this quantity');
    }
    return inventory;
  }

  async release(tx: Tx, inventoryId: string, qty: number) {
    await tx.$executeRaw`
      UPDATE inventory
      SET reserved_qty = GREATEST(reserved_qty - ${qty}, 0)
      WHERE id = CAST(${inventoryId} AS uuid)
    `;
  }

  async commitSale(tx: Tx, inventoryId: string, qty: number, orderId: string) {
    const updated = await tx.$executeRaw`
      UPDATE inventory
      SET on_hand_qty = on_hand_qty - ${qty},
          reserved_qty = GREATEST(reserved_qty - ${qty}, 0)
      WHERE id = CAST(${inventoryId} AS uuid)
        AND on_hand_qty >= ${qty}
    `;
    if (Number(updated) !== 1) {
      throw new ApiException(HttpStatus.CONFLICT, 'INSUFFICIENT_STOCK', 'Stock changed before dispatch');
    }
    await tx.stockMovement.create({
      data: { inventoryId, movementType: 'sale', qty: -qty, referenceType: 'order', referenceId: orderId },
    });
  }

  private async defaultWarehouse() {
    const warehouse = await this.prisma.warehouse.findFirst({ where: { isActive: true }, orderBy: { code: 'asc' } });
    if (!warehouse) throw new ApiException(HttpStatus.CONFLICT, 'NO_WAREHOUSE', 'No active warehouse is configured');
    return warehouse;
  }

  async expireReservations() {
    if (!this.prisma.ready) return 0;
    const stale = await this.prisma.inventoryReservation.findMany({
      where: { status: 'active', expiresAt: { lt: new Date() } },
      include: { orderItem: true },
      take: 100,
    });
    for (const reservation of stale) {
      await this.prisma.$transaction(async (tx) => {
        await this.release(tx, reservation.inventoryId, reservation.qty);
        await tx.inventoryReservation.update({
          where: { id: reservation.id },
          data: { status: 'expired' },
        });
        if (reservation.orderItem) {
          const order = await tx.order.findUnique({ where: { id: reservation.orderItem.orderId } });
          if (order?.status === 'pending_payment') {
            await tx.order.update({ where: { id: order.id }, data: { status: 'cancelled' } });
          }
        }
      });
    }
    return stale.length;
  }
}
