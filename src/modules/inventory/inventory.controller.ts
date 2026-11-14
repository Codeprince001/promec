import { Body, Controller, Get, Param, Post } from '@nestjs/common';
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
}
