import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApiException } from '../../common/api.exception';
import { chooseWarehouse } from '../../domain/commerce';
import { referenceCode } from '../../domain/slug';
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

  async receive(tx: Tx, skuId: string, warehouseId: string, qty: number, userId: string, referenceId: string) {
    if (qty <= 0) return;
    const inventory = await tx.inventory.upsert({
      where: { skuId_warehouseId: { skuId, warehouseId } },
      update: {},
      create: { skuId, warehouseId, onHandQty: 0 },
    });
    await tx.inventory.update({
      where: { id: inventory.id },
      data: {
        onHandQty: { increment: qty },
        movements: {
          create: { movementType: 'receipt', qty, reason: 'Goods receipt', userId, referenceType: 'goods_receipt', referenceId },
        },
      },
    });
  }

  async reserve(tx: Tx, skuId: string, qty: number, preferredState?: string | null) {
    const rows = await tx.inventory.findMany({
      where: { skuId, warehouse: { isActive: true } },
      include: { warehouse: true },
    });
    const choices = rows.map((row) => ({
      warehouseId: row.warehouseId,
      state: row.warehouse.state,
      available: row.onHandQty - row.reservedQty,
      id: row.id,
    }));
    const ordered: typeof choices = [];
    let remaining = [...choices];
    while (remaining.some((row) => row.available >= qty)) {
      const warehouseId = chooseWarehouse(remaining, qty, preferredState);
      const next = remaining.find((row) => row.warehouseId === warehouseId);
      if (!next) break;
      ordered.push(next);
      remaining = remaining.filter((row) => row.warehouseId !== warehouseId);
    }
    for (const row of ordered) {
      const updated = await tx.$executeRaw`
        UPDATE inventory
        SET reserved_qty = reserved_qty + ${qty}
        WHERE id = CAST(${row.id} AS uuid)
          AND (on_hand_qty - reserved_qty) >= ${qty}
      `;
      if (Number(updated) === 1) return rows.find((item) => item.id === row.id)!;
    }
    throw new ApiException(HttpStatus.CONFLICT, 'OUT_OF_STOCK', 'Not enough stock in one warehouse. Transfer stock before checkout.');
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

  async createBin(warehouseId: string, code: string, zone: string | undefined, warehouseIds: string[] | null) {
    this.assertWarehouse(warehouseId, warehouseIds);
    return this.prisma.bin.create({ data: { warehouseId, code: code.trim().toUpperCase(), zone } });
  }

  listBins(warehouseId: string | undefined, warehouseIds: string[] | null) {
    return this.prisma.bin.findMany({
      where: {
        ...(warehouseId ? { warehouseId } : {}),
        ...(warehouseIds ? { warehouseId: { in: warehouseIds } } : {}),
      },
      include: { stock: true },
      orderBy: { code: 'asc' },
    });
  }

  async placeInBin(binId: string, skuId: string, qty: number, warehouseIds: string[] | null) {
    const bin = await this.prisma.bin.findUnique({ where: { id: binId } });
    if (!bin) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Bin was not found');
    this.assertWarehouse(bin.warehouseId, warehouseIds);
    if (qty < 0) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_ERROR', 'Bin quantity cannot be negative');
    const inventory = await this.prisma.inventory.upsert({
      where: { skuId_warehouseId: { skuId, warehouseId: bin.warehouseId } },
      update: {},
      create: { skuId, warehouseId: bin.warehouseId, onHandQty: 0 },
    });
    return this.prisma.inventoryBin.upsert({
      where: { inventoryId_binId: { inventoryId: inventory.id, binId } },
      update: { qty },
      create: { inventoryId: inventory.id, binId, qty },
    });
  }

  async openCycleCount(warehouseId: string, lines: { skuId: string; binId?: string; countedQty: number }[], userId: string, warehouseIds: string[] | null) {
    this.assertWarehouse(warehouseId, warehouseIds);
    const prepared = [];
    for (const line of lines) {
      const inventory = await this.prisma.inventory.findUnique({ where: { skuId_warehouseId: { skuId: line.skuId, warehouseId } } });
      prepared.push({ skuId: line.skuId, binId: line.binId, expectedQty: inventory?.onHandQty ?? 0, countedQty: line.countedQty });
    }
    return this.prisma.cycleCount.create({
      data: { warehouseId, countedBy: userId, lines: { create: prepared } },
      include: { lines: true },
    });
  }

  async postCycleCount(id: string, userId: string, warehouseIds: string[] | null) {
    const count = await this.prisma.cycleCount.findUnique({ where: { id }, include: { lines: true } });
    if (!count) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Cycle count was not found');
    if (count.status !== 'open') throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'This cycle count is already posted');
    this.assertWarehouse(count.warehouseId, warehouseIds);
    await this.prisma.$transaction(async (tx) => {
      for (const line of count.lines) {
        const delta = line.countedQty - line.expectedQty;
        const inventory = await tx.inventory.upsert({
          where: { skuId_warehouseId: { skuId: line.skuId, warehouseId: count.warehouseId } },
          update: {},
          create: { skuId: line.skuId, warehouseId: count.warehouseId, onHandQty: 0 },
        });
        if (delta > 0) await this.receive(tx, line.skuId, count.warehouseId, delta, userId, count.id);
        if (delta < 0) {
          const updated = await tx.inventory.updateMany({
            where: { id: inventory.id, onHandQty: { gte: inventory.reservedQty - delta } },
            data: { onHandQty: { increment: delta } },
          });
          if (!updated.count) throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'Counted quantity would drop below reserved stock');
          await tx.stockMovement.create({
            data: { inventoryId: inventory.id, movementType: 'cycle_count', qty: delta, reason: 'Cycle count', userId, referenceType: 'cycle_count', referenceId: count.id },
          });
        }
        if (line.binId) {
          await tx.inventoryBin.upsert({
            where: { inventoryId_binId: { inventoryId: inventory.id, binId: line.binId } },
            update: { qty: line.countedQty },
            create: { inventoryId: inventory.id, binId: line.binId, qty: line.countedQty },
          });
        }
      }
      await tx.cycleCount.update({ where: { id }, data: { status: 'posted', postedAt: new Date() } });
    });
    return this.prisma.cycleCount.findUnique({ where: { id }, include: { lines: true } });
  }

  private assertWarehouse(warehouseId: string, warehouseIds: string[] | null) {
    if (warehouseIds && !warehouseIds.includes(warehouseId)) {
      throw new ApiException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'This warehouse is outside your scope');
    }
  }

  listTransfers(warehouseIds: string[] | null) {
    return this.prisma.stockTransfer.findMany({
      where: warehouseIds
        ? { OR: [{ fromWarehouseId: { in: warehouseIds } }, { toWarehouseId: { in: warehouseIds } }] }
        : undefined,
      include: { lines: true, fromWarehouse: true, toWarehouse: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }).then((rows) => rows.map((row) => ({
      id: row.id,
      transferNo: row.transferNo,
      status: row.status,
      from: row.fromWarehouse.code,
      to: row.toWarehouse.code,
      lines: row.lines.length,
    })));
  }

  listCycleCounts(warehouseIds: string[] | null) {
    return this.prisma.cycleCount.findMany({
      where: warehouseIds ? { warehouseId: { in: warehouseIds } } : undefined,
      include: { warehouse: true, lines: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }).then((rows) => rows.map((row) => ({
      id: row.id,
      status: row.status,
      warehouse: row.warehouse.code,
      lines: row.lines.length,
      createdAt: row.createdAt.toISOString(),
    })));
  }

  async createTransfer(
    input: { fromWarehouseId: string; toWarehouseId: string; lines: { skuId: string; qty: number }[] },
    userId: string,
    warehouseIds: string[] | null,
  ) {
    if (input.fromWarehouseId === input.toWarehouseId) {
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_ERROR', 'A transfer needs two different warehouses');
    }
    this.assertWarehouse(input.fromWarehouseId, warehouseIds);
    const destination = await this.prisma.warehouse.findFirst({ where: { id: input.toWarehouseId, isActive: true } });
    if (!destination) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Destination warehouse was not found');
    return this.prisma.stockTransfer.create({
      data: {
        transferNo: referenceCode('TR'),
        fromWarehouseId: input.fromWarehouseId,
        toWarehouseId: input.toWarehouseId,
        createdBy: userId,
        lines: { create: input.lines },
      },
      include: { lines: true },
    });
  }

  async shipTransfer(id: string, userId: string, warehouseIds: string[] | null) {
    const transfer = await this.prisma.stockTransfer.findUnique({ where: { id }, include: { lines: true } });
    if (!transfer) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Transfer was not found');
    if (transfer.status !== 'draft') throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'Only a draft transfer can be shipped');
    this.assertWarehouse(transfer.fromWarehouseId, warehouseIds);
    await this.prisma.$transaction(async (tx) => {
      for (const line of transfer.lines) {
        const inventory = await tx.inventory.findUnique({ where: { skuId_warehouseId: { skuId: line.skuId, warehouseId: transfer.fromWarehouseId } } });
        if (!inventory) throw new ApiException(HttpStatus.CONFLICT, 'INSUFFICIENT_STOCK', 'The source warehouse does not have this part');
        const moved = await tx.$executeRaw`
          UPDATE inventory
          SET on_hand_qty = on_hand_qty - ${line.qty}
          WHERE id = CAST(${inventory.id} AS uuid)
            AND (on_hand_qty - reserved_qty) >= ${line.qty}
        `;
        if (Number(moved) !== 1) throw new ApiException(HttpStatus.CONFLICT, 'INSUFFICIENT_STOCK', 'Reserved stock cannot be transferred');
        await tx.stockMovement.create({
          data: { inventoryId: inventory.id, movementType: 'transfer_out', qty: -line.qty, userId, referenceType: 'transfer', referenceId: transfer.id },
        });
      }
      await tx.stockTransfer.update({ where: { id }, data: { status: 'in_transit', shippedAt: new Date() } });
    });
    return this.prisma.stockTransfer.findUnique({ where: { id }, include: { lines: true } });
  }

  async receiveTransfer(id: string, userId: string, warehouseIds: string[] | null) {
    const transfer = await this.prisma.stockTransfer.findUnique({ where: { id }, include: { lines: true } });
    if (!transfer) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Transfer was not found');
    if (transfer.status !== 'in_transit') throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'Only an in-transit transfer can be received');
    this.assertWarehouse(transfer.toWarehouseId, warehouseIds);
    await this.prisma.$transaction(async (tx) => {
      for (const line of transfer.lines) {
        await this.receive(tx, line.skuId, transfer.toWarehouseId, line.qty, userId, transfer.id);
      }
      await tx.stockTransfer.update({ where: { id }, data: { status: 'received', receivedAt: new Date() } });
    });
    return this.prisma.stockTransfer.findUnique({ where: { id }, include: { lines: true } });
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
