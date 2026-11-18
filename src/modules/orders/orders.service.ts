import { HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus, Prisma } from '@prisma/client';
import { ApiException } from '../../common/api.exception';
import { money, moneyNumber } from '../../common/money';
import { pageMeta } from '../../common/pagination';
import { assertTransition, type OrderState } from '../../domain/order-status';
import { tradeUnitPrice } from '../../domain/commerce';
import { roundMoney } from '../../domain/credit';
import { referenceCode } from '../../domain/slug';
import { OutboxService } from '../../infra/outbox.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { AuditService } from '../audit/audit.service';
import { CreditService } from '../b2b/credit.service';
import { PaystackClient } from '../payments/paystack.client';
import { SettingsService } from '../settings/settings.service';
import { CartService } from '../cart/cart.service';
import { CompatibilityService } from '../compatibility/compatibility.service';
import { InventoryService } from '../inventory/inventory.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PromotionsService } from '../promotions/promotions.service';
import { ShippingService } from '../shipping/shipping.service';
import { VendorCommerceService } from '../vendors/vendor-commerce.service';

export type CheckoutInput = {
  userId?: string;
  guestToken?: string;
  addressId?: string;
  address?: {
    recipient: string;
    phone: string;
    state: string;
    lga?: string;
    city: string;
    street: string;
    landmark?: string;
  };
  contactEmail?: string;
  contactPhone?: string;
  deliveryMethod: 'courier' | 'pickup';
  courierCode?: 'gig' | 'dhl';
  paymentMethod: 'paystack' | 'bank_transfer' | 'account_credit';
  couponCode?: string;
  confirmPriceChange?: boolean;
  confirmUnverifiedFit?: boolean;
  notes?: string;
  idempotencyKey?: string;
};

@Injectable()
export class OrdersService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cart: CartService,
    private readonly compatibility: CompatibilityService,
    private readonly inventory: InventoryService,
    private readonly shipping: ShippingService,
    private readonly promotions: PromotionsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly paystack: PaystackClient,
    private readonly credit: CreditService,
    private readonly analytics: AnalyticsService,
    private readonly vendors: VendorCommerceService,
    private readonly outbox: OutboxService,
    private readonly settings: SettingsService,
  ) {}

  onModuleInit() {
    this.outbox.register('shipment.delivered', async (payload) => {
      if (typeof payload.orderId !== 'string') return;
      const order = await this.prisma.order.findUnique({ where: { id: payload.orderId } });
      if (order?.status === 'dispatched') await this.transition(payload.orderId, 'delivered', null);
    });
  }

  async checkout(input: CheckoutInput) {
    if (input.idempotencyKey) {
      const existing = await this.prisma.idempotencyKey.findUnique({ where: { key: input.idempotencyKey } });
      if (existing) return replayCheckout(existing.response);
    }
    const customer = input.userId ? await this.prisma.customer.findUnique({ where: { userId: input.userId } }) : null;
    const account = input.userId ? await this.prisma.user.findUnique({ where: { id: input.userId } }) : null;
    const contactEmail = input.contactEmail ?? account?.email ?? undefined;
    const guestAllowed = await this.settings.guestCheckoutEnabled();
    if (!customer && !guestAllowed) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Sign in to check out');
    }
    if (!customer && !contactEmail) {
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_ERROR', 'Guest checkout needs an email address');
    }
    const address = await this.resolveAddress(customer?.id, input);
    const open = await this.cart.openCart({ userId: input.userId, guestToken: input.guestToken });
    if (!open.items.length) throw new ApiException(HttpStatus.CONFLICT, 'CART_EMPTY', 'Your cart is empty');

    const trade = input.userId ? await this.credit.accountFor(input.userId) : null;
    const listPrices = trade ? await this.credit.listPrices(trade.accountId, open.items.map((item) => item.skuId)) : new Map<string, number>();
    const vendorIds = [...new Set(open.items.flatMap((item) => (item.sku.product.vendorId ? [item.sku.product.vendorId] : [])))];
    const vendorRows = vendorIds.length ? await this.prisma.vendor.findMany({ where: { id: { in: vendorIds } } }) : [];
    const vendorById = new Map(vendorRows.map((vendor) => [vendor.id, vendor]));
    const lines: { item: (typeof open.items)[number]; unitPrice: number; discount: number; vendorFulfils: boolean; vendorId?: string }[] = [];
    let weight = 0;
    for (const item of open.items) {
      const current = moneyNumber(item.sku.sellingPrice);
      const snapshot = moneyNumber(item.unitPriceSnapshot);
      if (current !== snapshot && !input.confirmPriceChange) {
        throw new ApiException(HttpStatus.CONFLICT, 'PRICE_CHANGED', 'A price changed. Confirm to continue.', {
          skuId: item.skuId,
          from: money(snapshot),
          to: money(current),
        });
      }
      if (item.vehicleVariantId) {
        const decision = await this.compatibility.check(item.sku.productId, item.vehicleVariantId);
        if (decision.status === 'incompatible') {
          throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'INCOMPATIBLE', decision.notes);
        }
        if (decision.status !== 'confirmed' && !input.confirmUnverifiedFit) {
          throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'FITMENT_CONFIRMATION_REQUIRED', decision.notes, {
            skuId: item.skuId,
            status: decision.status,
          });
        }
        item.fitmentStatusSnapshot = decision.status;
      }
      const seller = item.sku.product.vendorId ? vendorById.get(item.sku.product.vendorId) : undefined;
      if (seller && seller.status !== 'approved') {
        throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'This vendor is not allowed to sell');
      }
      const priced = tradeUnitPrice(current, trade?.discountRate ?? 0, listPrices.get(item.skuId) ?? null);
      weight += item.sku.weightG * item.qty;
      lines.push({
        item,
        unitPrice: priced.unit,
        discount: priced.discount,
        vendorFulfils: seller?.fulfilmentMode === 'vendor',
        vendorId: seller?.id,
      });
    }
    const subtotal = lines.reduce((sum, line) => sum + moneyNumber(line.item.sku.sellingPrice) * line.item.qty, 0);
    const creditTerms = input.paymentMethod === 'account_credit' ? await this.tradeAccount(input.userId) : null;
    const tradeDiscount = roundMoney(lines.reduce((sum, line) => sum + line.discount * line.item.qty, 0));
    const merchandise = roundMoney(subtotal - tradeDiscount);
    const promo = await this.promotions.preview(input.couponCode, merchandise);
    const quote = await this.shipping.quote(address.state, weight, input.deliveryMethod, input.courierCode);
    const shippingTotal = Number(quote.amount);
    const grand = Math.max(0, subtotal - tradeDiscount - promo.discount + shippingTotal);
    if (creditTerms) this.credit.assertAmount(creditTerms, grand);
    const orderNo = referenceCode('PRM');
    const providerRef = referenceCode('PAY');

    let body: ReturnType<typeof presentOrder>;
    try {
      body = await this.prisma.$transaction(async (tx) => {
      if (input.idempotencyKey) {
        await tx.idempotencyKey.create({
          data: { key: input.idempotencyKey, userId: input.userId, response: { state: 'processing' } },
        });
      }
      const created = await tx.order.create({
        data: {
          orderNo,
          customerId: customer?.id,
          businessAccountId: creditTerms?.accountId,
          contactEmail,
          contactPhone: input.contactPhone ?? address.phone,
          status: creditTerms ? 'processing' : 'pending_payment',
          subtotal,
          discountTotal: promo.discount + tradeDiscount,
          shippingTotal,
          grandTotal: grand,
          couponCode: promo.code,
          deliveryMethod: input.deliveryMethod,
          courierCode: quote.courier,
          shippingAddress: address,
          notes: input.notes,
          items: {
            create: lines.map((line) => ({
              skuId: line.item.skuId,
              qty: line.item.qty,
              unitPrice: line.unitPrice,
              vehicleVariantId: line.item.vehicleVariantId,
              fitmentStatus: line.item.fitmentStatusSnapshot,
              warrantyMonths: line.item.sku.product.warrantyMonths,
            })),
          },
          payments: {
            create: {
              provider: input.paymentMethod === 'paystack' ? 'paystack' : input.paymentMethod === 'account_credit' ? 'account_credit' : 'bank_transfer',
              providerRef,
              amount: grand,
              currency: 'NGN',
              method: input.paymentMethod,
              status: 'pending',
              dueAt: creditTerms?.dueAt,
            },
          },
        },
        include: { items: true, payments: true },
      });
      for (const [index, item] of created.items.entries()) {
        const line = lines[index];
        if (line?.vendorFulfils && line.vendorId) {
          await this.vendors.reserve(tx, line.vendorId, item.skuId, item.qty, item.id);
          continue;
        }
        const stock = await this.inventory.reserve(tx, item.skuId, item.qty, address.state);
        await tx.inventoryReservation.create({
          data: {
            inventoryId: stock.id,
            orderItemId: item.id,
            qty: item.qty,
            expiresAt: new Date(Date.now() + 30 * 60_000),
          },
        });
      }
      if (creditTerms) await this.vendors.accrue(tx, created.id);
      if (promo.code) await this.promotions.consume(tx, promo.code);
      if (creditTerms) {
        await this.credit.draw(tx, {
          accountId: creditTerms.accountId,
          orderId: created.id,
          amount: grand,
          reference: orderNo,
          spendingLimit: creditTerms.spendingLimit,
        });
      }
      await tx.cartItem.deleteMany({ where: { cartId: open.id } });
      await tx.cart.update({ where: { id: open.id }, data: { status: 'checked_out' } });
      const full = await tx.order.findUniqueOrThrow({ where: { id: created.id }, include: orderInclude });
      const presented = presentOrder(full);
      if (input.idempotencyKey) {
        await tx.idempotencyKey.update({
          where: { key: input.idempotencyKey },
          data: { response: jsonValue(presented) },
        });
      }
      return presented;
    });
    } catch (error) {
      if (input.idempotencyKey && isIdempotencyConflict(error)) {
        const existing = await this.prisma.idempotencyKey.findUnique({ where: { key: input.idempotencyKey } });
        if (existing) return replayCheckout(existing.response);
      }
      throw error;
    }

    if (customer) {
      await this.notifications.enqueue({
        userId: input.userId,
        channel: 'email',
        template: 'order.placed',
        payload: { orderNo: body.orderNo, total: body.grandTotal },
      });
    }
    if (creditTerms) {
      await this.analytics.record('sale', grand, { orderNo: body.orderNo, channel: 'account_credit' });
    }
    if (input.paymentMethod === 'bank_transfer') {
      const reference = body.payments[0]?.reference;
      const bank = await this.settings.bankDetails();
      return {
        ...body,
        bankTransfer: {
          accountName: bank.accountName,
          bankName: bank.bankName,
          accountNumber: bank.accountNumber,
          reference,
          amount: body.grandTotal,
          proofUrl: reference ? `/api/v1/payments/${reference}/proof` : null,
        },
      };
    }
    if (input.paymentMethod === 'paystack' && contactEmail) {
      const reference = body.payments[0]?.reference;
      if (reference) {
        try {
          const started = await this.paystack.initialize({
            email: contactEmail,
            amountKobo: Math.round(moneyNumber(body.grandTotal) * 100),
            reference,
          });
          const withPayment = { ...body, authorizationUrl: started.authorizationUrl };
          if (input.idempotencyKey) {
            await this.prisma.idempotencyKey.update({
              where: { key: input.idempotencyKey },
              data: { response: jsonValue(withPayment) },
            });
          }
          return withPayment;
        } catch {
          return body;
        }
      }
    }
    return body;
  }

  async mine(userId: string, page: number, pageSize: number) {
    const customer = await this.prisma.customer.findUnique({ where: { userId } });
    if (!customer) return { data: [], meta: pageMeta(page, pageSize, 0) };
    const where = { customerId: customer.id };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({ where, include: orderInclude, orderBy: { placedAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.order.count({ where }),
    ]);
    return { data: rows.map(presentOrder), meta: pageMeta(page, pageSize, total) };
  }

  async one(id: string, userId?: string, staff = false) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: orderInclude });
    if (!order) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Order was not found');
    if (!staff) {
      const customer = userId ? await this.prisma.customer.findUnique({ where: { userId } }) : null;
      if (!customer || order.customerId !== customer.id) {
        throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Order was not found');
      }
    }
    return presentOrder(order);
  }

  async adminList(page: number, pageSize: number, status?: OrderStatus) {
    const where = status ? { status } : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({ where, include: orderInclude, orderBy: { placedAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.order.count({ where }),
    ]);
    return { data: rows.map(presentOrder), meta: pageMeta(page, pageSize, total) };
  }

  async deskOrder(actorId: string, input: {
    customerId?: string;
    contactEmail?: string;
    contactPhone?: string;
    address: { recipient: string; phone: string; state: string; lga?: string; city: string; street: string; landmark?: string };
    lines: { skuId: string; qty: number }[];
    paymentMethod: 'paystack' | 'bank_transfer' | 'counter';
    notes?: string;
  }) {
    if (!input.customerId && !input.contactEmail) {
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_ERROR', 'A counter order needs a customer or an email');
    }
    const customer = input.customerId ? await this.prisma.customer.findUnique({ where: { id: input.customerId }, include: { user: true } }) : null;
    if (input.customerId && !customer) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Customer was not found');
    const skus = await this.prisma.productSku.findMany({
      where: { id: { in: input.lines.map((line) => line.skuId) } },
      include: { product: true },
    });
    const byId = new Map(skus.map((sku) => [sku.id, sku]));
    const lines = input.lines.map((line) => {
      const sku = byId.get(line.skuId);
      if (!sku || sku.product.deletedAt || sku.product.status === 'archived') {
        throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'A part on this order is not for sale');
      }
      return { sku, qty: line.qty };
    });
    const subtotal = lines.reduce((sum, line) => sum + moneyNumber(line.sku.sellingPrice) * line.qty, 0);
    const weight = lines.reduce((sum, line) => sum + line.sku.weightG * line.qty, 0);
    const quote = await this.shipping.quote(input.address.state, weight, 'courier');
    const shippingTotal = Number(quote.amount);
    const grand = Math.max(0, subtotal + shippingTotal);
    const orderNo = referenceCode('PRM');
    const providerRef = referenceCode('PAY');
    const contactEmail = input.contactEmail ?? customer?.user.email ?? undefined;
    const created = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          orderNo,
          customerId: customer?.id,
          contactEmail,
          contactPhone: input.contactPhone ?? input.address.phone,
          status: 'pending_payment',
          subtotal,
          discountTotal: 0,
          shippingTotal,
          grandTotal: grand,
          deliveryMethod: 'courier',
          courierCode: quote.courier,
          shippingAddress: input.address,
          notes: input.notes ? `Counter sale. ${input.notes}` : 'Counter sale',
          items: {
            create: lines.map((line) => ({
              skuId: line.sku.id,
              qty: line.qty,
              unitPrice: moneyNumber(line.sku.sellingPrice),
              warrantyMonths: line.sku.product.warrantyMonths,
            })),
          },
          payments: {
            create: {
              provider: input.paymentMethod === 'paystack' ? 'paystack' : input.paymentMethod === 'counter' ? 'counter' : 'bank_transfer',
              providerRef,
              amount: grand,
              currency: 'NGN',
              method: input.paymentMethod,
              status: 'pending',
            },
          },
        },
        include: { items: true },
      });
      for (const item of order.items) {
        const stock = await this.inventory.reserve(tx, item.skuId, item.qty, input.address.state);
        await tx.inventoryReservation.create({
          data: { inventoryId: stock.id, orderItemId: item.id, qty: item.qty, expiresAt: new Date(Date.now() + 30 * 60_000) },
        });
      }
      return order;
    });
    await this.audit.log({ actorId, action: 'order.desk', entityType: 'order', entityId: created.id, after: { orderNo, paymentMethod: input.paymentMethod } });
    if (input.paymentMethod === 'counter') {
      return this.markPaid(providerRef, grand);
    }
    return this.one(created.id, actorId, true);
  }

  async cancelMine(id: string, userId: string) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    const customer = await this.prisma.customer.findUnique({ where: { userId } });
    if (!order || !customer || order.customerId !== customer.id) {
      throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Order was not found');
    }
    if (order.status !== 'pending_payment' && order.status !== 'payment_failed') {
      throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'This order can no longer be cancelled online');
    }
    return this.transition(id, 'cancelled', userId);
  }

  async markPaid(reference: string, amountMajor: number, raw?: Prisma.InputJsonValue) {
    const payment = await this.prisma.payment.findUnique({ where: { providerRef: reference }, include: { order: true } });
    if (!payment) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Payment reference was not found');
    if (payment.status === 'paid') return presentOrder(await this.prisma.order.findUniqueOrThrow({ where: { id: payment.orderId }, include: orderInclude }));
    if (Math.abs(moneyNumber(payment.amount) - amountMajor) > 0.01) {
      throw new ApiException(HttpStatus.CONFLICT, 'AMOUNT_MISMATCH', 'Paid amount does not match the order');
    }
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'paid', verifiedAt: new Date(), rawResponse: raw },
    });
    await this.transition(payment.orderId, 'paid', null);
    await this.prisma.$transaction((tx) => this.vendors.accrue(tx, payment.orderId));
    await this.analytics.record('sale', amountMajor, { orderNo: payment.order.orderNo, channel: payment.provider });
    return this.transition(payment.orderId, 'processing', null);
  }

  async transition(id: string, to: OrderState, actorId: string | null) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { items: { include: { reservations: { include: { inventory: true } }, sku: true } } },
    });
    if (!order) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Order was not found');
    try {
      assertTransition(order.status, to);
    } catch (error) {
      throw new ApiException(HttpStatus.CONFLICT, 'INVALID_TRANSITION', error instanceof Error ? error.message : 'Invalid status');
    }
    await this.prisma.$transaction(async (tx) => {
      if (to === 'cancelled' || to === 'payment_failed') {
        for (const item of order.items) {
          for (const reservation of item.reservations.filter((row) => row.status === 'active')) {
            await this.inventory.release(tx, reservation.inventoryId, reservation.qty);
            await tx.inventoryReservation.update({ where: { id: reservation.id }, data: { status: 'released' } });
          }
          await this.vendors.release(tx, item.id);
        }
        if (to === 'cancelled') {
          await this.credit.reverse(tx, order.id);
          await this.vendors.reverse(tx, order.id);
        }
      }
      if (to === 'dispatched') {
        const warehouses = new Set<string>();
        for (const item of order.items) {
          for (const reservation of item.reservations.filter((row) => row.status === 'active')) {
            await this.inventory.commitSale(tx, reservation.inventoryId, reservation.qty, order.id);
            await tx.inventoryReservation.update({ where: { id: reservation.id }, data: { status: 'committed' } });
            warehouses.add(reservation.inventory.warehouseId);
          }
        }
        const weight = order.items.reduce((sum, item) => sum + item.sku.weightG * item.qty, 0);
        for (const [index, warehouseId] of [...warehouses].entries()) {
          await this.shipping.book(tx, {
            orderId: order.id,
            orderNo: order.orderNo,
            address: order.shippingAddress,
            weightG: weight,
            value: Number(order.grandTotal),
            courierCode: order.courierCode,
            fee: index === 0 ? Number(order.shippingTotal) : 0,
            warehouseId,
          });
        }
      }
      if (to === 'delivered') {
        await tx.shipment.updateMany({ where: { orderId: order.id }, data: { status: 'delivered', deliveredAt: new Date() } });
      }
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: to,
          ...(to === 'paid' || to === 'processing' ? { paymentStatus: 'paid' } : {}),
          ...(to === 'dispatched' ? { fulfilmentStatus: 'fulfilled' } : {}),
          ...(to === 'cancelled' ? { fulfilmentStatus: 'cancelled' } : {}),
        },
      });
    });
    await this.audit.log({ actorId, action: 'order.transition', entityType: 'order', entityId: id, before: { status: order.status }, after: { status: to } });
    return this.one(id, undefined, true);
  }

  async placeFromQuote(quoteId: string, userId: string, input: { address: CheckoutInput['address']; paymentMethod: CheckoutInput['paymentMethod']; courierCode?: 'gig' | 'dhl' }) {
    if (!input.address) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_ERROR', 'Delivery address is required');
    const customer = await this.prisma.customer.findUnique({ where: { userId } });
    const quote = await this.prisma.quote.findUnique({ where: { id: quoteId }, include: { items: { include: { sku: true } } } });
    if (!quote || !customer || quote.customerId !== customer.id) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Quote was not found');
    if (quote.status !== 'approved' || quote.orderId) throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'Only an approved quote that has not been ordered can be accepted');
    if (quote.validUntil && quote.validUntil < new Date()) throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'This quote has expired');
    if (quote.items.some((item) => !item.skuId || !item.sku)) {
      throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'Every quoted line needs a catalogue SKU before it can become an order');
    }
    const creditTerms = input.paymentMethod === 'account_credit' ? await this.tradeAccount(userId) : null;
    const subtotal = quote.items.reduce((sum, item) => sum + Number(item.unitPrice) * item.qty, 0);
    const weight = quote.items.reduce((sum, item) => sum + (item.sku?.weightG ?? 0) * item.qty, 0);
    const shipping = await this.shipping.quote(input.address.state, weight, 'courier', input.courierCode);
    const grand = roundMoney(subtotal + Number(shipping.amount));
    if (creditTerms) this.credit.assertAmount(creditTerms, grand);
    const orderNo = referenceCode('PRM');
    const providerRef = referenceCode('PAY');
    const order = await this.prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          orderNo,
          customerId: customer.id,
          businessAccountId: quote.businessAccountId,
          contactPhone: input.address?.phone,
          status: creditTerms ? 'processing' : 'pending_payment',
          subtotal,
          shippingTotal: Number(shipping.amount),
          grandTotal: grand,
          deliveryMethod: 'courier',
          courierCode: shipping.courier,
          shippingAddress: input.address,
          notes: `Quote ${quote.quoteNo}`,
          items: {
            create: quote.items.map((item) => ({
              skuId: item.skuId!,
              qty: item.qty,
              unitPrice: item.unitPrice,
              warrantyMonths: item.sku?.productId ? 0 : 0,
            })),
          },
          payments: {
            create: {
              provider: input.paymentMethod === 'paystack' ? 'paystack' : input.paymentMethod === 'account_credit' ? 'account_credit' : 'bank_transfer',
              providerRef,
              amount: grand,
              currency: 'NGN',
              method: input.paymentMethod,
              status: 'pending',
              dueAt: creditTerms?.dueAt,
            },
          },
        },
        include: { items: true },
      });
      for (const item of created.items) {
        const stock = await this.inventory.reserve(tx, item.skuId, item.qty, input.address?.state);
        await tx.inventoryReservation.create({
          data: { inventoryId: stock.id, orderItemId: item.id, qty: item.qty, expiresAt: new Date(Date.now() + 30 * 60_000) },
        });
      }
      await tx.quote.update({ where: { id: quote.id }, data: { orderId: created.id, status: 'ordered' } });
      if (creditTerms) await this.vendors.accrue(tx, created.id);
      return created;
    });
    return this.one(order.id, userId);
  }

  listReturns() {
    return this.prisma.returnRequest.findMany({
      include: { order: { select: { orderNo: true, status: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }).then((rows) => rows.map((row) => ({
      id: row.id,
      orderId: row.orderId,
      orderNo: row.order.orderNo,
      orderStatus: row.order.status,
      status: row.status,
      reasonCode: row.reasonCode,
      restockQty: row.restockQty,
      createdAt: row.createdAt.toISOString(),
    })));
  }

  async requestReturn(id: string, userId: string, reasonCode: string, notes?: string) {
    const customer = await this.prisma.customer.findUnique({ where: { userId } });
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order || !customer || order.customerId !== customer.id) {
      throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Order was not found');
    }
    if (order.status !== 'delivered') {
      throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'Returns open after delivery');
    }
    const request = await this.prisma.returnRequest.create({ data: { orderId: id, reasonCode, notes } });
    await this.transition(id, 'return_requested', userId);
    return request;
  }

  async decideReturn(id: string, actorId: string, decision: 'approved' | 'rejected', note?: string) {
    const request = await this.returnOrThrow(id);
    if (request.status !== 'requested') throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'This return was already decided');
    const updated = await this.prisma.returnRequest.update({
      where: { id },
      data: { status: decision, inspectionNote: note },
    });
    if (decision === 'rejected') await this.transition(request.orderId, 'completed', actorId);
    await this.notifyReturn(request.orderId, decision);
    return updated;
  }

  async receiveReturn(id: string) {
    const request = await this.returnOrThrow(id);
    if (request.status !== 'approved') throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'Only an approved return can be received');
    return this.prisma.returnRequest.update({ where: { id }, data: { status: 'received' } });
  }

  async inspectReturn(id: string, actorId: string, restockQty: number, note?: string) {
    const request = await this.returnOrThrow(id);
    if (request.status !== 'received') throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'Receive the return before inspection');
    const order = await this.prisma.order.findUnique({ where: { id: request.orderId }, include: { items: true } });
    if (!order) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Order was not found');
    const ordered = order.items.reduce((sum, item) => sum + item.qty, 0);
    if (restockQty > ordered) throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'Restock quantity is higher than the order');
    const shipment = await this.prisma.shipment.findFirst({ where: { orderId: request.orderId, warehouseId: { not: null } } });
    const warehouse = shipment?.warehouseId
      ? await this.prisma.warehouse.findUnique({ where: { id: shipment.warehouseId } })
      : await this.prisma.warehouse.findFirst({ where: { isActive: true }, orderBy: { code: 'asc' } });
    if (!warehouse) throw new ApiException(HttpStatus.CONFLICT, 'NO_WAREHOUSE', 'No active warehouse is configured');
    let remaining = restockQty;
    await this.prisma.$transaction(async (tx) => {
      for (const item of order.items) {
        if (remaining <= 0) break;
        const qty = Math.min(item.qty, remaining);
        await this.inventory.receive(tx, item.skuId, warehouse.id, qty, actorId, request.id);
        remaining -= qty;
      }
      await tx.returnRequest.update({
        where: { id },
        data: { status: 'inspected', restockQty, inspectionNote: note, inspectedAt: new Date() },
      });
    });
    return this.prisma.returnRequest.findUnique({ where: { id } });
  }

  async refundReturn(id: string, actorId: string) {
    const request = await this.returnOrThrow(id);
    if (request.status !== 'inspected') throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'Inspect the return before refunding');
    const order = await this.prisma.order.findUnique({ where: { id: request.orderId }, include: { payments: { include: { refunds: true } } } });
    if (!order) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Order was not found');
    const payment = order.payments.find((row) => row.status === 'paid' || row.status === 'partially_refunded');
    if (!payment) throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'There is no successful payment to refund');
    const already = payment.refunds.reduce((sum, refund) => sum + Number(refund.amount), 0);
    const amount = Math.max(0, Number(payment.amount) - already);
    if (amount <= 0) throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'This payment is already refunded');
    if (payment.provider === 'paystack' && payment.providerRef) await this.paystack.refund(payment.providerRef, amount);
    await this.prisma.refund.create({
      data: { paymentId: payment.id, orderId: order.id, amount, reason: `Return ${request.reasonCode}`, status: payment.provider === 'paystack' ? 'paid' : 'pending', approvedBy: actorId },
    });
    await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'refunded' } });
    await this.prisma.returnRequest.update({ where: { id }, data: { status: 'refunded' } });
    if (order.status === 'return_requested') await this.transition(order.id, 'returned', actorId);
    await this.notifyReturn(order.id, 'refunded');
    return this.prisma.returnRequest.findUnique({ where: { id } });
  }

  private async returnOrThrow(id: string) {
    const request = await this.prisma.returnRequest.findUnique({ where: { id } });
    if (!request) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Return was not found');
    return request;
  }

  private async notifyReturn(orderId: string, status: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { customer: true } });
    if (!order?.customer?.userId && !order?.contactEmail) return;
    await this.notifications.enqueue({
      userId: order.customer?.userId,
      to: order.contactEmail,
      channel: 'email',
      template: 'return.updated',
      payload: { orderNo: order.orderNo, status },
    });
  }

  private async resolveAddress(customerId: string | undefined, input: CheckoutInput) {
    if (input.addressId) {
      if (!customerId) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_ERROR', 'Saved addresses need an account');
      const address = await this.prisma.customerAddress.findFirst({ where: { id: input.addressId, customerId } });
      if (!address) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Address was not found');
      return { recipient: address.recipient, phone: address.phone, state: address.state, lga: address.lga, city: address.city, street: address.street, landmark: address.landmark };
    }
    if (!input.address) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_ERROR', 'Delivery address is required');
    return input.address;
  }

  private async tradeAccount(userId: string | undefined) {
    if (!userId) throw new ApiException(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Sign in to use a trade account');
    return this.credit.termsFor(userId);
  }
}

function stateOf(value: Prisma.JsonValue | null): string {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'state' in value && typeof value.state === 'string') return value.state;
  return 'Lagos';
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function replayCheckout(response: Prisma.JsonValue) {
  if (response && typeof response === 'object' && !Array.isArray(response) && 'orderNo' in response) return response;
  throw new ApiException(HttpStatus.CONFLICT, 'IDEMPOTENCY_IN_PROGRESS', 'This checkout is already running');
}

function isIdempotencyConflict(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
  const target = error.meta?.target;
  const text = Array.isArray(target) ? target.join(',') : String(target ?? '');
  return text === 'key' || text.includes('idempotency');
}

const orderInclude = {
  items: { include: { sku: { include: { product: true } } } },
  payments: true,
  shipments: { include: { events: true } },
} satisfies Prisma.OrderInclude;

function presentOrder(order: Prisma.OrderGetPayload<{ include: typeof orderInclude }>) {
  return {
    id: order.id,
    orderNo: order.orderNo,
    status: order.status,
    paymentStatus: order.paymentStatus,
    fulfilmentStatus: order.fulfilmentStatus,
    currency: order.currencyCode,
    subtotal: money(order.subtotal),
    discountTotal: money(order.discountTotal),
    shippingTotal: money(order.shippingTotal),
    grandTotal: money(order.grandTotal),
    couponCode: order.couponCode,
    deliveryMethod: order.deliveryMethod,
    courierCode: order.courierCode,
    shippingAddress: order.shippingAddress,
    placedAt: order.placedAt.toISOString(),
    items: order.items.map((item) => ({
      id: item.id,
      sku: item.sku.sku,
      name: item.sku.product.name,
      qty: item.qty,
      unitPrice: money(item.unitPrice),
      fitmentStatus: item.fitmentStatus,
    })),
    payments: order.payments.map((payment) => ({
      id: payment.id,
      provider: payment.provider,
      reference: payment.providerRef,
      amount: money(payment.amount),
      status: payment.status,
      method: payment.method,
    })),
    shipments: order.shipments.map((shipment) => ({
      id: shipment.id,
      status: shipment.status,
      trackingNo: shipment.trackingNo,
      labelUrl: shipment.labelUrl,
      events: shipment.events,
    })),
  };
}
