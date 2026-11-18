import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { money } from '../../common/money';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { InventoryService } from './inventory.service';
import { RbacService } from '../rbac/rbac.service';

const adjustSchema = z.object({
  qtyDelta: z.number().int(),
  reason: z.string().min(3).max(200),
});

@ApiTags('inventory')
@Controller('admin/inventory')
export class InventoryController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly rbac: RbacService,
  ) {}

  @Get()
  @Permissions('inventory.manage')
  async list(@CurrentUser() user: AuthUser) {
    const rows = await this.inventory.list(await this.rbac.warehouseIds(user.sub, 'inventory.manage'));
    return rows.map((row) => ({
      id: row.id,
      skuId: row.skuId,
      sku: row.sku.sku,
      product: row.sku.product.name,
      warehouse: row.warehouse.code,
      onHandQty: row.onHandQty,
      reservedQty: row.reservedQty,
      availableQty: row.onHandQty - row.reservedQty,
      reorderPoint: row.reorderPoint,
      avgCost: money(row.avgCost),
    }));
  }

  @Post(':skuId/adjustments')
  @Permissions('inventory.manage')
  adjust(
    @CurrentUser() user: AuthUser,
    @Param('skuId') skuId: string,
    @Body({ schema: adjustSchema }) body: z.infer<typeof adjustSchema>,
  ) {
    return this.rbac.warehouseIds(user.sub, 'inventory.manage').then((warehouseIds) =>
      this.inventory.adjust(skuId, body.qtyDelta, body.reason, user.sub, warehouseIds),
    );
  }

  @Get('warehouses')
  @Permissions('inventory.manage')
  warehouses(@CurrentUser() user: AuthUser) {
    return this.rbac.warehouseIds(user.sub, 'inventory.manage').then((warehouseIds) => this.inventory.listWarehouses(warehouseIds));
  }

  @Post('warehouses')
  @Permissions('inventory.manage')
  createWarehouse(
    @Body({ schema: z.object({ code: z.string().min(2).max(12), name: z.string().min(2).max(80), address: z.string().max(200).optional(), state: z.string().max(40).optional(), isActive: z.boolean().optional() }) })
    body: { code: string; name: string; address?: string; state?: string; isActive?: boolean },
  ) {
    return this.inventory.saveWarehouse(body);
  }

  @Patch('warehouses/:id')
  @Permissions('inventory.manage')
  updateWarehouse(
    @Param('id') id: string,
    @Body({ schema: z.object({ code: z.string().min(2).max(12), name: z.string().min(2).max(80), address: z.string().max(200).nullable().optional(), state: z.string().max(40).nullable().optional(), isActive: z.boolean().optional() }) })
    body: { code: string; name: string; address?: string | null; state?: string | null; isActive?: boolean },
  ) {
    return this.inventory.saveWarehouse({ ...body, id });
  }

  @Get('transfers')
  @Permissions('inventory.manage')
  transfers(@CurrentUser() user: AuthUser) {
    return this.rbac.warehouseIds(user.sub, 'inventory.manage').then((warehouseIds) => this.inventory.listTransfers(warehouseIds));
  }

  @Get('cycle-counts')
  @Permissions('inventory.manage')
  cycleCounts(@CurrentUser() user: AuthUser) {
    return this.rbac.warehouseIds(user.sub, 'inventory.manage').then((warehouseIds) => this.inventory.listCycleCounts(warehouseIds));
  }

  @Get('bins')
  @Permissions('inventory.manage')
  bins(@CurrentUser() user: AuthUser) {
    return this.rbac.warehouseIds(user.sub, 'inventory.manage').then((warehouseIds) => this.inventory.listBins(undefined, warehouseIds));
  }

  @Post('bins')
  @Permissions('inventory.manage')
  createBin(
    @CurrentUser() user: AuthUser,
    @Body({ schema: z.object({ warehouseId: z.string().uuid(), code: z.string().min(1).max(40), zone: z.string().max(40).optional() }) }) body: { warehouseId: string; code: string; zone?: string },
  ) {
    return this.rbac.warehouseIds(user.sub, 'inventory.manage').then((warehouseIds) => this.inventory.createBin(body.warehouseId, body.code, body.zone, warehouseIds));
  }

  @Post('bins/:id/stock')
  @Permissions('inventory.manage')
  place(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body({ schema: z.object({ skuId: z.string().uuid(), qty: z.number().int().min(0) }) }) body: { skuId: string; qty: number },
  ) {
    return this.rbac.warehouseIds(user.sub, 'inventory.manage').then((warehouseIds) => this.inventory.placeInBin(id, body.skuId, body.qty, warehouseIds));
  }

  @Post('cycle-counts')
  @Permissions('inventory.manage')
  openCount(
    @CurrentUser() user: AuthUser,
    @Body({ schema: z.object({ warehouseId: z.string().uuid(), lines: z.array(z.object({ skuId: z.string().uuid(), binId: z.string().uuid().optional(), countedQty: z.number().int().min(0) })).min(1) }) }) body: { warehouseId: string; lines: { skuId: string; binId?: string; countedQty: number }[] },
  ) {
    return this.rbac.warehouseIds(user.sub, 'inventory.manage').then((warehouseIds) => this.inventory.openCycleCount(body.warehouseId, body.lines, user.sub, warehouseIds));
  }

  @Post('transfers')
  @Permissions('inventory.manage')
  transfer(
    @CurrentUser() user: AuthUser,
    @Body({ schema: z.object({ fromWarehouseId: z.string().uuid(), toWarehouseId: z.string().uuid(), lines: z.array(z.object({ skuId: z.string().uuid(), qty: z.number().int().positive() })).min(1) }) })
    body: { fromWarehouseId: string; toWarehouseId: string; lines: { skuId: string; qty: number }[] },
  ) {
    return this.rbac.warehouseIds(user.sub, 'inventory.manage').then((warehouseIds) => this.inventory.createTransfer(body, user.sub, warehouseIds));
  }

  @Post('transfers/:id/ship')
  @Permissions('inventory.manage')
  shipTransfer(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.rbac.warehouseIds(user.sub, 'inventory.manage').then((warehouseIds) => this.inventory.shipTransfer(id, user.sub, warehouseIds));
  }

  @Post('transfers/:id/receive')
  @Permissions('inventory.manage')
  receiveTransfer(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.rbac.warehouseIds(user.sub, 'inventory.manage').then((warehouseIds) => this.inventory.receiveTransfer(id, user.sub, warehouseIds));
  }

  @Post('cycle-counts/:id/post')
  @Permissions('inventory.manage')
  postCount(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.rbac.warehouseIds(user.sub, 'inventory.manage').then((warehouseIds) => this.inventory.postCycleCount(id, user.sub, warehouseIds));
  }
}
