import { Body, Controller, Get, Module, Param, Patch, Post } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UserType } from '@prisma/client';
import { z } from 'zod';
import { ApiException } from '../../common/api.exception';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { money } from '../../common/money';
import { PrismaService } from '../../prisma/prisma.service';
import { CatalogueModule } from '../catalogue/catalogue.module';
import { CatalogueService, productWriteSchema } from '../catalogue/catalogue.service';
import { VendorCommerceService } from './vendor-commerce.service';

const applySchema = z.object({ businessName: z.string().min(2).max(160) });
const reviewSchema = z.object({
  status: z.enum(['pending', 'approved', 'suspended', 'rejected']),
  commissionRate: z.number().min(0).max(0.5).optional(),
  fulfilmentMode: z.enum(['promec', 'vendor']).optional(),
});

@ApiTags('vendors')
@Controller()
export class VendorsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogue: CatalogueService,
    private readonly commerce: VendorCommerceService,
  ) {}

  @Post('vendors/apply')
  async apply(@CurrentUser() user: AuthUser, @Body({ schema: applySchema }) body: z.infer<typeof applySchema>) {
    const existing = await this.prisma.vendor.findUnique({ where: { userId: user.sub } });
    if (existing) throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'A vendor application already exists');
    await this.prisma.user.update({ where: { id: user.sub }, data: { userType: UserType.vendor } });
    return this.prisma.vendor.create({ data: { userId: user.sub, businessName: body.businessName } });
  }

  @Get('admin/vendors')
  @Permissions('vendors.manage')
  list() {
    return this.prisma.vendor.findMany({ orderBy: { createdAt: 'desc' } });
  }

  @Patch('admin/vendors/:id')
  @Permissions('vendors.manage')
  review(@Param('id') id: string, @Body({ schema: reviewSchema }) body: z.infer<typeof reviewSchema>) {
    return this.prisma.vendor.update({ where: { id }, data: body });
  }

  @Get('admin/vendors/:id/ledger')
  @Permissions('vendors.manage')
  async ledger(@Param('id') id: string) {
    const rows = await this.prisma.vendorLedger.findMany({ where: { vendorId: id }, orderBy: { createdAt: 'desc' } });
    return { balance: money(await this.commerce.balance(id)), entries: rows.map((row) => ({ ...row, amount: money(row.amount) })) };
  }

  @Post('admin/vendors/:id/payouts')
  @Permissions('vendors.manage')
  payout(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body({ schema: z.object({ amount: z.number().positive(), reference: z.string().min(2).max(80) }) }) body: { amount: number; reference: string },
  ) {
    return this.commerce.payout(id, body.amount, body.reference, user.sub);
  }

  @Post('vendor/products')
  async listProduct(@CurrentUser() user: AuthUser, @Body({ schema: productWriteSchema }) body: z.infer<typeof productWriteSchema>) {
    const vendor = await this.approvedVendor(user.sub);
    if (body.status === 'published') {
      throw new ApiException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'A vendor listing stays in review until PROMEC publishes it');
    }
    const created = await this.catalogue.create({ ...body, stockQty: vendor.fulfilmentMode === 'vendor' ? 0 : body.stockQty, status: 'in_review' }, user.sub);
    await this.prisma.product.update({ where: { id: created.id }, data: { vendorId: vendor.id, status: 'in_review' } });
    if (vendor.fulfilmentMode === 'vendor') {
      const sku = await this.prisma.productSku.findFirst({ where: { productId: created.id } });
      if (sku) {
        await this.prisma.vendorStock.create({ data: { vendorId: vendor.id, skuId: sku.id, onHandQty: body.stockQty } });
      }
    }
    return this.prisma.product.findUnique({ where: { id: created.id }, include: { skus: true } });
  }

  @Get('vendor/products')
  async myProducts(@CurrentUser() user: AuthUser) {
    const vendor = await this.approvedVendor(user.sub);
    return this.prisma.product.findMany({ where: { vendorId: vendor.id, deletedAt: null }, include: { skus: { include: { vendorStock: true } } }, orderBy: { createdAt: 'desc' } });
  }

  @Get('vendor/orders')
  async myOrders(@CurrentUser() user: AuthUser) {
    const vendor = await this.approvedVendor(user.sub);
    return this.prisma.order.findMany({
      where: { items: { some: { sku: { product: { vendorId: vendor.id } } } } },
      include: { items: { include: { sku: { include: { product: true } } } } },
      orderBy: { placedAt: 'desc' },
      take: 100,
    });
  }

  @Post('vendor/orders/:id/ship')
  async ship(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body({ schema: z.object({ trackingNo: z.string().min(4).max(40) }) }) body: { trackingNo: string }) {
    const vendor = await this.approvedVendor(user.sub);
    const order = await this.prisma.order.findUnique({ where: { id }, include: { items: { include: { sku: { include: { product: true } } } } } });
    const mine = order?.items.filter((item) => item.sku.product.vendorId === vendor.id) ?? [];
    if (!order || !mine.length) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Order was not found');
    if (!['processing', 'packed', 'dispatched'].includes(order.status)) {
      throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'This order is not ready for the vendor to ship');
    }
    await this.prisma.$transaction(async (tx) => {
      for (const item of mine) await this.commerce.commit(tx, item.id);
      await tx.shipment.create({
        data: {
          orderId: order.id,
          courierName: 'vendor',
          trackingNo: body.trackingNo,
          status: 'dispatched',
          shippedAt: new Date(),
          events: { create: { status: 'booked', note: `${vendor.businessName} handed the parcel to their courier`, source: 'vendor' } },
        },
      });
    });
    return { orderId: order.id, trackingNo: body.trackingNo };
  }

  private async approvedVendor(userId: string) {
    const vendor = await this.prisma.vendor.findUnique({ where: { userId } });
    if (!vendor || vendor.status !== 'approved') {
      throw new ApiException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Only an approved vendor can sell');
    }
    return vendor;
  }
}

@Module({
  imports: [CatalogueModule],
  controllers: [VendorsController],
  providers: [VendorCommerceService],
  exports: [VendorCommerceService],
})
export class VendorsModule {}
