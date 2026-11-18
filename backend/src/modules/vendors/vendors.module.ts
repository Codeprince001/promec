import { Body, Controller, Get, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiException } from '../../common/api.exception';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { money } from '../../common/money';
import { PrismaService } from '../../prisma/prisma.service';
import { CatalogueModule } from '../catalogue/catalogue.module';
import { CatalogueService, productWriteSchema } from '../catalogue/catalogue.service';
import { VendorCommerceService } from './vendor-commerce.service';
import { VendorStoreService, applySchema, pageQuery, storeProfileSchema } from './vendor-store.service';

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
    private readonly stores: VendorStoreService,
  ) {}

  @Public()
  @Get('vendors')
  listPublic(@Query({ schema: pageQuery }) query: z.infer<typeof pageQuery>) {
    return this.stores.listPublic(query);
  }

  @Post('vendors/apply')
  apply(@CurrentUser() user: AuthUser, @Body({ schema: applySchema }) body: z.infer<typeof applySchema>) {
    return this.stores.apply(user.sub, body);
  }

  @Public()
  @Get('vendors/:slug')
  store(@Param('slug') slug: string) {
    return this.stores.publicStore(slug);
  }

  @Public()
  @Get('vendors/:slug/products')
  storeProducts(@Param('slug') slug: string, @Query({ schema: pageQuery }) query: z.infer<typeof pageQuery>) {
    return this.stores.publicProducts(slug, query);
  }

  @Public()
  @Get('vendors/:slug/reviews')
  storeReviews(@Param('slug') slug: string, @Query({ schema: pageQuery }) query: z.infer<typeof pageQuery>) {
    return this.stores.publicReviews(slug, query);
  }

  @Post('vendors/:slug/reviews')
  rateStore(
    @CurrentUser() user: AuthUser,
    @Param('slug') slug: string,
    @Body({ schema: z.object({ orderNo: z.string().trim().min(3).max(40), rating: z.number().int().min(1).max(5), comment: z.string().trim().max(1000).optional() }) })
    body: { orderNo: string; rating: number; comment?: string },
  ) {
    return this.stores.review(user.sub, slug, body);
  }

  @Get('vendor/store')
  myStore(@CurrentUser() user: AuthUser) {
    return this.stores.mine(user.sub);
  }

  @Patch('vendor/store')
  updateStore(@CurrentUser() user: AuthUser, @Body({ schema: storeProfileSchema }) body: z.infer<typeof storeProfileSchema>) {
    return this.stores.update(user.sub, body);
  }

  @Get('vendor/withdrawals')
  myWithdrawals(@CurrentUser() user: AuthUser) {
    return this.stores.myWithdrawals(user.sub);
  }

  @Post('vendor/withdrawals')
  withdraw(
    @CurrentUser() user: AuthUser,
    @Body({ schema: z.object({ amount: z.number().positive(), note: z.string().trim().max(240).optional() }) }) body: { amount: number; note?: string },
  ) {
    return this.stores.requestWithdrawal(user.sub, body.amount, body.note);
  }

  @Get('admin/vendor-withdrawals')
  @Permissions('vendors.manage')
  withdrawalQueue(@Query({ schema: z.object({ status: z.string().optional() }) }) query: { status?: string }) {
    return this.stores.adminWithdrawals(query.status);
  }

  @Post('admin/vendor-withdrawals/:id')
  @Permissions('vendors.manage')
  decideWithdrawal(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body({ schema: z.object({ action: z.enum(['approve', 'reject', 'pay']), reference: z.string().trim().min(2).max(80).optional() }) })
    body: { action: 'approve' | 'reject' | 'pay'; reference?: string },
  ) {
    return this.stores.decide(user.sub, id, body.action, body.reference);
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

  @Get('admin/vendors/:id/reviews')
  @Permissions('vendors.manage')
  reviews(@Param('id') id: string) {
    return this.prisma.vendorReview.findMany({ where: { vendorId: id }, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  @Patch('admin/reviews/:id')
  @Permissions('vendors.manage')
  moderate(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body({ schema: z.object({ hidden: z.boolean() }) }) body: { hidden: boolean }) {
    return this.stores.setReviewHidden(user.sub, id, body.hidden);
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
  providers: [VendorCommerceService, VendorStoreService],
  exports: [VendorCommerceService],
})
export class VendorsModule {}
