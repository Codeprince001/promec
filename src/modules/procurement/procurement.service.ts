import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApiException } from '../../common/api.exception';
import { money } from '../../common/money';
import { receiptProgress, threeWayMatch } from '../../domain/three-way-match';
import { referenceCode } from '../../domain/slug';
import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { AuditService } from '../audit/audit.service';
import { InventoryService } from '../inventory/inventory.service';

const poInclude = {
  supplier: true,
  items: true,
  receipts: { include: { lines: true, warehouse: true } },
  invoices: { include: { lines: true } },
} satisfies Prisma.PurchaseOrderInclude;

@Injectable()
export class ProcurementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
    private readonly analytics: AnalyticsService,
  ) {}

  list() {
    return this.prisma.purchaseOrder.findMany({ include: poInclude, orderBy: { createdAt: 'desc' } });
  }

  async one(id: string) {
    const order = await this.prisma.purchaseOrder.findUnique({ where: { id }, include: poInclude });
    if (!order) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Purchase order was not found');
    return presentPurchaseOrder(order);
  }

  async create(input: {
    supplierId: string;
    currency: string;
    incoterm?: string;
    items: { description: string; qty: number; unitPrice: number; weightKg: number; skuId?: string }[];
  }) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id: input.supplierId } });
    if (!supplier || supplier.status !== 'approved') {
      throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'Supplier is not approved for a purchase order');
    }
    const skuIds = input.items.flatMap((item) => (item.skuId ? [item.skuId] : []));
    if (skuIds.length) {
      const found = await this.prisma.productSku.count({ where: { id: { in: skuIds } } });
      if (found !== new Set(skuIds).size) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'A purchase-order SKU was not found');
    }
    const total = input.items.reduce((sum, item) => sum + item.qty * item.unitPrice, 0);
    const created = await this.prisma.purchaseOrder.create({
      data: {
        poNo: referenceCode('PO'),
        supplierId: input.supplierId,
        currency: input.currency.toUpperCase(),
        incoterm: input.incoterm,
        total,
        items: { create: input.items },
      },
      include: poInclude,
    });
    return presentPurchaseOrder(created);
  }

  async issue(id: string, actorId: string) {
    const order = await this.prisma.purchaseOrder.findUnique({ where: { id } });
    if (!order) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Purchase order was not found');
    if (order.status !== 'draft') throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'Only a draft purchase order can be issued');
    const updated = await this.prisma.purchaseOrder.update({ where: { id }, data: { status: 'issued' }, include: poInclude });
    await this.audit.log({ actorId, action: 'po.issue', entityType: 'purchase_order', entityId: id, after: { status: 'issued' } });
    return presentPurchaseOrder(updated);
  }

  async receive(
    id: string,
    actorId: string,
    input: { warehouseId: string; lines: { itemId: string; qty: number }[] },
  ) {
    const order = await this.prisma.purchaseOrder.findUnique({ where: { id }, include: { items: true, receipts: { include: { lines: true } } } });
    if (!order) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Purchase order was not found');
    if (order.status !== 'issued' && order.status !== 'partially_received') {
      throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'Goods can be received only against an issued purchase order');
    }
    const warehouse = await this.prisma.warehouse.findFirst({ where: { id: input.warehouseId, isActive: true } });
    if (!warehouse) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Warehouse was not found');
    const received = receivedByItem(order.receipts);
    for (const line of input.lines) {
      const item = order.items.find((row) => row.id === line.itemId);
      if (!item) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Purchase-order line was not found');
      const already = received.get(item.id) ?? 0;
      if (already + line.qty > item.qty) {
        throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', `Receipt for ${item.description} exceeds the ordered quantity`);
      }
    }
    const receipt = await this.prisma.goodsReceipt.create({
      data: {
        grnNo: referenceCode('GRN'),
        purchaseOrderId: order.id,
        warehouseId: warehouse.id,
        receivedBy: actorId,
        status: 'received',
        lines: { create: input.lines.map((line) => ({ purchaseOrderItemId: line.itemId, qtyReceived: line.qty })) },
      },
      include: { lines: true },
    });
    await this.refreshReceiptStatus(order.id);
    await this.audit.log({ actorId, action: 'po.receive', entityType: 'goods_receipt', entityId: receipt.id, after: { poId: order.id, lines: input.lines } });
    return receipt;
  }

  async inspect(
    grnId: string,
    actorId: string,
    lines: { id: string; qtyAccepted: number; qtyRejected: number; note?: string }[],
  ) {
    const receipt = await this.prisma.goodsReceipt.findUnique({
      where: { id: grnId },
      include: { lines: { include: { purchaseOrderItem: true } } },
    });
    if (!receipt) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Goods receipt was not found');
    if (receipt.status !== 'received') throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'This receipt has already been inspected');
    if (lines.length !== receipt.lines.length) {
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_ERROR', 'Inspection must cover every receipt line');
    }
    await this.prisma.$transaction(async (tx) => {
      for (const decision of lines) {
        const line = receipt.lines.find((row) => row.id === decision.id);
        if (!line) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Receipt line was not found');
        if (decision.qtyAccepted + decision.qtyRejected !== line.qtyReceived) {
          throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_ERROR', 'Accepted and rejected quantities must add up to the quantity received');
        }
        await tx.goodsReceiptLine.update({
          where: { id: line.id },
          data: { qtyAccepted: decision.qtyAccepted, qtyRejected: decision.qtyRejected, qcNote: decision.note },
        });
        if (decision.qtyAccepted > 0 && line.purchaseOrderItem.skuId) {
          await this.inventory.receive(tx, line.purchaseOrderItem.skuId, receipt.warehouseId, decision.qtyAccepted, actorId, receipt.id);
        }
      }
      const rejected = lines.every((line) => line.qtyAccepted === 0);
      await tx.goodsReceipt.update({ where: { id: receipt.id }, data: { status: rejected ? 'rejected' : 'accepted' } });
    });
    await this.refreshReceiptStatus(receipt.purchaseOrderId);
    await this.audit.log({ actorId, action: 'po.inspect', entityType: 'goods_receipt', entityId: grnId, after: { lines } });
    return this.prisma.goodsReceipt.findUnique({ where: { id: grnId }, include: { lines: true } });
  }

  async createInvoice(
    poId: string,
    input: { invoiceNo: string; lines: { itemId: string; qty: number; unitPrice: number }[] },
  ) {
    const order = await this.prisma.purchaseOrder.findUnique({ where: { id: poId }, include: { items: true } });
    if (!order) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Purchase order was not found');
    if (order.status === 'draft' || order.status === 'cancelled') {
      throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'Invoice a purchase order only after it is issued');
    }
    for (const line of input.lines) {
      if (!order.items.some((item) => item.id === line.itemId)) {
        throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Invoice line is not on the purchase order');
      }
    }
    const total = input.lines.reduce((sum, line) => sum + line.qty * line.unitPrice, 0);
    return this.prisma.supplierInvoice.create({
      data: {
        invoiceNo: input.invoiceNo,
        purchaseOrderId: order.id,
        currency: order.currency,
        total,
        lines: { create: input.lines.map((line) => ({ purchaseOrderItemId: line.itemId, qty: line.qty, unitPrice: line.unitPrice })) },
      },
      include: { lines: true },
    });
  }

  async match(invoiceId: string) {
    const invoice = await this.prisma.supplierInvoice.findUnique({
      where: { id: invoiceId },
      include: { lines: true, purchaseOrder: { include: { items: true, receipts: { include: { lines: true } } } } },
    });
    if (!invoice) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Supplier invoice was not found');
    const accepted = new Map<string, number>();
    for (const receipt of invoice.purchaseOrder.receipts) {
      for (const line of receipt.lines) accepted.set(line.purchaseOrderItemId, (accepted.get(line.purchaseOrderItemId) ?? 0) + line.qtyAccepted);
    }
    const billed = new Map<string, { qty: number; unitPrice: number }>();
    for (const line of invoice.lines) {
      const current = billed.get(line.purchaseOrderItemId) ?? { qty: 0, unitPrice: Number(line.unitPrice) };
      billed.set(line.purchaseOrderItemId, { qty: current.qty + line.qty, unitPrice: Number(line.unitPrice) });
    }
    const result = threeWayMatch([...billed.entries()].map(([poItemId, bill]) => {
      const item = invoice.purchaseOrder.items.find((row) => row.id === poItemId);
      return {
        poItemId: item ? poItemId : '',
        orderedQty: item?.qty ?? 0,
        orderPrice: item ? Number(item.unitPrice) : 0,
        acceptedQty: accepted.get(poItemId) ?? 0,
        invoicedQty: bill.qty,
        invoicePrice: bill.unitPrice,
      };
    }));
    return this.prisma.supplierInvoice.update({
      where: { id: invoice.id },
      data: { status: result.status, matchResult: result },
      include: { lines: true },
    });
  }

  async approve(invoiceId: string, actorId: string) {
    const invoice = await this.prisma.supplierInvoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Supplier invoice was not found');
    if (invoice.status !== 'matched') {
      throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'Only a matched invoice can be approved for payment');
    }
    const updated = await this.prisma.supplierInvoice.update({ where: { id: invoiceId }, data: { status: 'approved' } });
    await this.audit.log({
      actorId,
      action: 'invoice.approve',
      entityType: 'supplier_invoice',
      entityId: invoiceId,
      after: { invoiceNo: invoice.invoiceNo, total: money(invoice.total) },
    });
    return updated;
  }

  async pay(invoiceId: string, actorId: string, method: string, reference: string) {
    const invoice = await this.prisma.supplierInvoice.findUnique({ where: { id: invoiceId }, include: { payment: true } });
    if (!invoice) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Supplier invoice was not found');
    if (invoice.status !== 'approved') throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'Approve the matched invoice before paying it');
    if (invoice.payment) throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'This invoice already has a payment');
    const payment = await this.prisma.supplierPayment.create({
      data: {
        supplierInvoiceId: invoice.id,
        amount: invoice.total,
        currency: invoice.currency,
        method,
        reference,
        paidBy: actorId,
      },
    });
    await this.prisma.supplierInvoice.update({ where: { id: invoice.id }, data: { status: 'paid' } });
    await this.analytics.record('purchase', Number(invoice.total), { invoiceNo: invoice.invoiceNo, currency: invoice.currency, reference });
    await this.audit.log({ actorId, action: 'invoice.pay', entityType: 'supplier_invoice', entityId: invoice.id, after: { reference, amount: money(invoice.total) } });
    return payment;
  }

  async createRfq(
    input: { notes?: string; dueAt?: string; lines: { skuId?: string; description: string; qty: number }[] },
    actorId: string,
  ) {
    return this.prisma.requestForQuote.create({
      data: {
        rfqNo: referenceCode('RFQ'),
        notes: input.notes,
        dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
        createdBy: actorId,
        lines: { create: input.lines },
      },
      include: { lines: true, responses: { include: { lines: true } } },
    });
  }

  async recordSupplierQuote(
    rfqId: string,
    input: { supplierId: string; currency: string; note?: string; lines: { rfqLineId: string; unitPrice: number; leadTimeDays: number }[] },
  ) {
    const rfq = await this.prisma.requestForQuote.findUnique({ where: { id: rfqId }, include: { lines: true } });
    if (!rfq || rfq.status !== 'open') throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'This request for quote is not open');
    const supplier = await this.prisma.supplier.findUnique({ where: { id: input.supplierId } });
    if (!supplier || supplier.status !== 'approved') throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'Supplier is not approved');
    const lineIds = new Set(rfq.lines.map((line) => line.id));
    if (input.lines.some((line) => !lineIds.has(line.rfqLineId))) {
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_ERROR', 'A quoted line is not on this request');
    }
    const existing = await this.prisma.supplierQuote.findUnique({ where: { rfqId_supplierId: { rfqId, supplierId: input.supplierId } } });
    if (existing?.status === 'awarded') throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'An awarded quote cannot be revised');
    if (existing) {
      await this.prisma.supplierQuoteLine.deleteMany({ where: { quoteId: existing.id } });
      return this.prisma.supplierQuote.update({
        where: { id: existing.id },
        data: { currency: input.currency.toUpperCase(), note: input.note, lines: { create: input.lines } },
        include: { lines: true },
      });
    }
    return this.prisma.supplierQuote.create({
      data: {
        rfqId,
        supplierId: input.supplierId,
        currency: input.currency.toUpperCase(),
        note: input.note,
        lines: { create: input.lines },
      },
      include: { lines: true },
    });
  }

  async awardRfq(rfqId: string, quoteId: string, actorId: string) {
    const quote = await this.prisma.supplierQuote.findUnique({
      where: { id: quoteId },
      include: { lines: { include: { rfqLine: true } }, rfq: { include: { lines: true, purchaseOrder: true } } },
    });
    if (!quote || quote.rfqId !== rfqId) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Supplier quote was not found');
    if (quote.rfq.status !== 'open' || quote.rfq.purchaseOrder) {
      throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'This request has already been awarded');
    }
    if (quote.lines.length !== quote.rfq.lines.length) {
      throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'The supplier has not priced every line');
    }
    const purchase = await this.create({
      supplierId: quote.supplierId,
      currency: quote.currency,
      items: quote.lines.map((line) => ({
        skuId: line.rfqLine.skuId ?? undefined,
        description: line.rfqLine.description,
        qty: line.rfqLine.qty,
        unitPrice: Number(line.unitPrice),
        weightKg: 0,
      })),
    });
    await this.prisma.purchaseOrder.update({ where: { id: purchase.id }, data: { rfqId } });
    await this.prisma.supplierQuote.update({ where: { id: quote.id }, data: { status: 'awarded' } });
    await this.prisma.supplierQuote.updateMany({ where: { rfqId, id: { not: quote.id } }, data: { status: 'declined' } });
    await this.prisma.requestForQuote.update({ where: { id: rfqId }, data: { status: 'awarded' } });
    await this.audit.log({ actorId, action: 'rfq.award', entityType: 'request_for_quote', entityId: rfqId, after: { quoteId, purchaseOrderId: purchase.id } });
    return this.one(purchase.id);
  }

  private async refreshReceiptStatus(poId: string) {
    const order = await this.prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: { items: true, receipts: { include: { lines: true } } },
    });
    if (!order || order.status === 'cancelled' || order.status === 'closed') return;
    const received = receivedByItem(order.receipts);
    const accepted = new Map<string, number>();
    for (const receipt of order.receipts) {
      for (const line of receipt.lines) accepted.set(line.purchaseOrderItemId, (accepted.get(line.purchaseOrderItemId) ?? 0) + line.qtyAccepted);
    }
    const status = receiptProgress(order.items.map((item) => ({
      ordered: item.qty,
      received: received.get(item.id) ?? 0,
      accepted: accepted.get(item.id) ?? 0,
    })));
    if (status !== order.status) await this.prisma.purchaseOrder.update({ where: { id: poId }, data: { status } });
  }
}

function receivedByItem(receipts: { lines: { purchaseOrderItemId: string; qtyReceived: number }[] }[]) {
  const totals = new Map<string, number>();
  for (const receipt of receipts) {
    for (const line of receipt.lines) totals.set(line.purchaseOrderItemId, (totals.get(line.purchaseOrderItemId) ?? 0) + line.qtyReceived);
  }
  return totals;
}

function presentPurchaseOrder(order: Prisma.PurchaseOrderGetPayload<{ include: typeof poInclude }>) {
  return {
    ...order,
    total: money(order.total),
    items: order.items.map((item) => ({ ...item, unitPrice: money(item.unitPrice), weightKg: money(item.weightKg) })),
    invoices: order.invoices.map((invoice) => ({
      ...invoice,
      total: money(invoice.total),
      lines: invoice.lines.map((line) => ({ ...line, unitPrice: money(line.unitPrice) })),
    })),
  };
}
