import { Body, Controller, Get, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { landedCost } from '../../domain/landed-cost';
import { canAdvanceImport } from '../../domain/operations';
import { ApiException } from '../../common/api.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { ProcurementService } from './procurement.service';

const poSchema = z.object({
  supplierId: z.string().uuid(),
  currency: z.string().length(3),
  incoterm: z.string().optional(),
  items: z.array(z.object({
    skuId: z.string().uuid().optional(),
    description: z.string().min(2),
    qty: z.number().int().positive(),
    unitPrice: z.number().positive(),
    weightKg: z.number().min(0).default(0),
  })).min(1),
});

const receiptSchema = z.object({
  warehouseId: z.string().uuid(),
  lines: z.array(z.object({ itemId: z.string().uuid(), qty: z.number().int().positive() })).min(1),
});

const inspectionSchema = z.object({
  lines: z.array(z.object({
    id: z.string().uuid(),
    qtyAccepted: z.number().int().min(0),
    qtyRejected: z.number().int().min(0),
    note: z.string().max(300).optional(),
  })).min(1),
});

const invoiceSchema = z.object({
  invoiceNo: z.string().min(2).max(80),
  lines: z.array(z.object({
    itemId: z.string().uuid(),
    qty: z.number().int().positive(),
    unitPrice: z.number().positive(),
  })).min(1),
});

const costSchema = z.object({
  unitPriceFx: z.number().nonnegative(),
  fxRate: z.number().positive(),
  freightAlloc: z.number().nonnegative().default(0),
  insuranceAlloc: z.number().nonnegative().default(0),
  dutyAlloc: z.number().nonnegative().default(0),
  clearingAlloc: z.number().nonnegative().default(0),
  bankAlloc: z.number().nonnegative().default(0),
  handlingPerUnit: z.number().nonnegative().default(0),
  fxBufferPct: z.number().min(0).max(1).default(0.02),
  targetMargin: z.number().min(0).max(0.9).default(0.25),
  floorPrice: z.number().min(0).default(0),
});

const importSchema = z.object({
  poId: z.string().uuid().optional(),
  mode: z.enum(['air', 'sea', 'courier']),
  blAwbNo: z.string().optional(),
  eta: z.string().datetime().optional(),
});

@ApiTags('procurement')
@Controller('admin')
export class ProcurementController {
  constructor(
    private readonly procurement: ProcurementService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('purchase-orders')
  @Permissions('procurement.manage')
  listOrders() {
    return this.procurement.list();
  }

  @Get('purchase-orders/:id')
  @Permissions('procurement.manage')
  one(@Param('id') id: string) {
    return this.procurement.one(id);
  }

  @Post('purchase-orders')
  @Permissions('procurement.manage')
  createOrder(@Body({ schema: poSchema }) body: z.infer<typeof poSchema>) {
    return this.procurement.create(body);
  }

  @Post('purchase-orders/:id/issue')
  @Permissions('procurement.manage')
  issue(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.procurement.issue(id, user.sub);
  }

  @Post('purchase-orders/:id/receipts')
  @Permissions('procurement.manage')
  receive(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body({ schema: receiptSchema }) body: z.infer<typeof receiptSchema>) {
    return this.procurement.receive(id, user.sub, body);
  }

  @Post('goods-receipts/:id/inspection')
  @Permissions('procurement.manage')
  inspect(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body({ schema: inspectionSchema }) body: z.infer<typeof inspectionSchema>) {
    return this.procurement.inspect(id, user.sub, body.lines);
  }

  @Post('purchase-orders/:id/invoices')
  @Permissions('procurement.manage')
  invoice(@Param('id') id: string, @Body({ schema: invoiceSchema }) body: z.infer<typeof invoiceSchema>) {
    return this.procurement.createInvoice(id, body);
  }

  @Post('supplier-invoices/:id/match')
  @Permissions('procurement.manage')
  match(@Param('id') id: string) {
    return this.procurement.match(id);
  }

  @Post('supplier-invoices/:id/approve')
  @Permissions('procurement.manage')
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.procurement.approve(id, user.sub);
  }

  @Post('supplier-invoices/:id/pay')
  @Permissions('procurement.manage')
  pay(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body({ schema: z.object({ method: z.string().min(2).max(40), reference: z.string().min(2).max(80) }) }) body: { method: string; reference: string },
  ) {
    return this.procurement.pay(id, user.sub, body.method, body.reference);
  }

  @Get('rfqs')
  @Permissions('procurement.manage')
  listRfqs() {
    return this.prisma.requestForQuote.findMany({ include: { lines: true, responses: { include: { lines: true } } }, orderBy: { createdAt: 'desc' } });
  }

  @Post('rfqs')
  @Permissions('procurement.manage')
  createRfq(
    @CurrentUser() user: AuthUser,
    @Body({ schema: z.object({
      notes: z.string().max(1000).optional(),
      dueAt: z.string().datetime().optional(),
      lines: z.array(z.object({ skuId: z.string().uuid().optional(), description: z.string().min(2), qty: z.number().int().positive() })).min(1),
    }) }) body: { notes?: string; dueAt?: string; lines: { skuId?: string; description: string; qty: number }[] },
  ) {
    return this.procurement.createRfq(body, user.sub);
  }

  @Post('rfqs/:id/quotes')
  @Permissions('procurement.manage')
  quoteRfq(
    @Param('id') id: string,
    @Body({ schema: z.object({
      supplierId: z.string().uuid(),
      currency: z.string().length(3),
      note: z.string().max(500).optional(),
      lines: z.array(z.object({ rfqLineId: z.string().uuid(), unitPrice: z.number().positive(), leadTimeDays: z.number().int().min(0).default(0) })).min(1),
    }) }) body: { supplierId: string; currency: string; note?: string; lines: { rfqLineId: string; unitPrice: number; leadTimeDays: number }[] },
  ) {
    return this.procurement.recordSupplierQuote(id, body);
  }

  @Post('rfqs/:id/award')
  @Permissions('procurement.manage')
  awardRfq(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body({ schema: z.object({ quoteId: z.string().uuid() }) }) body: { quoteId: string },
  ) {
    return this.procurement.awardRfq(id, body.quoteId, user.sub);
  }

  @Post('purchase-orders/landed-cost')
  @Permissions('procurement.manage')
  price(@Body({ schema: costSchema }) body: z.infer<typeof costSchema>) {
    const result = landedCost(body);
    return { landedUnitCost: result.landedUnitCost.toFixed(2), sellingPrice: result.sellingPrice.toFixed(2), currency: 'NGN' };
  }

  @Get('imports')
  @Permissions('procurement.manage')
  listImports() {
    return this.prisma.importRecord.findMany({ include: { milestones: true, documents: true }, orderBy: { createdAt: 'desc' } });
  }

  @Post('imports')
  @Permissions('procurement.manage')
  createImport(@Body({ schema: importSchema }) body: z.infer<typeof importSchema>) {
    return this.prisma.importRecord.create({
      data: {
        poId: body.poId,
        mode: body.mode,
        blAwbNo: body.blAwbNo,
        eta: body.eta ? new Date(body.eta) : undefined,
        milestones: { create: { step: 'planned', note: 'Shipment opened' } },
      },
      include: { milestones: true, documents: true },
    });
  }

  @Post('imports/:id/advance')
  @Permissions('procurement.manage')
  async advance(@Param('id') id: string, @Body({ schema: z.object({ step: z.string().min(2), note: z.string().max(300).optional() }) }) body: { step: string; note?: string }) {
    const record = await this.prisma.importRecord.findUnique({ where: { id } });
    if (!record) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Import was not found');
    if (!canAdvanceImport(record.status, body.step)) {
      throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', `The next customs step after ${record.status} is required`);
    }
    return this.prisma.importRecord.update({
      where: { id },
      data: { status: body.step, milestones: { create: { step: body.step, note: body.note } } },
      include: { milestones: true, documents: true },
    });
  }

  @Post('imports/:id/documents')
  @Permissions('procurement.manage')
  document(
    @Param('id') id: string,
    @Body({ schema: z.object({ kind: z.enum(['bl', 'invoice', 'packing_list', 'form_m', 'paar']), url: z.string().url() }) }) body: { kind: string; url: string },
  ) {
    return this.prisma.importDocument.create({ data: { importRecordId: id, kind: body.kind, url: body.url } });
  }

  @Post('imports/:id/duty')
  @Permissions('procurement.manage')
  duty(@Param('id') id: string, @Body({ schema: z.object({ dutyTotal: z.number().nonnegative() }) }) body: { dutyTotal: number }) {
    return this.prisma.importRecord.update({ where: { id }, data: { dutyTotal: body.dutyTotal } });
  }
}
