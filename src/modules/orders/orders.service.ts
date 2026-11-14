import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus, Prisma } from '@prisma/client';
import { ApiException } from '../../common/api.exception';
import { money, moneyNumber } from '../../common/money';
import { pageMeta } from '../../common/pagination';
import { assertTransition, type OrderState } from '../../domain/order-status';
import { referenceCode } from '../../domain/slug';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PaystackClient } from '../payments/paystack.client';
import { CartService } from '../cart/cart.service';
import { CompatibilityService } from '../compatibility/compatibility.service';
import { InventoryService } from '../inventory/inventory.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PromotionsService } from '../promotions/promotions.service';
import { ShippingService } from '../shipping/shipping.service';

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
  paymentMethod: 'paystack' | 'bank_transfer';
  couponCode?: string;
  confirmPriceChange?: boolean;
  confirmUnverifiedFit?: boolean;
  notes?: string;
  idempotencyKey?: string;
};

@Injectable()
export class OrdersService {
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
  ) {}

  async checkout(input: CheckoutInput) {
    if (input.idempotencyKey) {
      const existing = await this.prisma.idempotencyKey.findUnique({ where: { key: input.idempotencyKey } });
      if (existing) return replayCheckout(existing.response);
    }
    const customer = input.userId ? await this.prisma.customer.findUnique({ where: { userId: input.userId } }) : null;
    const account = input.userId ? await this.prisma.user.findUnique({ where: { id: input.userId } }) : null;
    const contactEmail = input.contactEmail ?? account?.email ?? undefined;
    const guestAllowed = this.config.get('FEATURE_GUEST_CHECKOUT') === 'true';
    if (!customer && !guestAllowed) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Sign in to check out');
    }
    if (!customer && !contactEmail) {
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_ERROR', 'Guest checkout needs an email address');
    }
    const address = await this.resolveAddress(customer?.id, input);
    const open = await this.cart.openCart({ userId: input.userId, guestToken: input.guestToken });
    if (!open.items.length) throw new ApiException(HttpStatus.CONFLICT, 'CART_EMPTY', 'Your cart is empty');

    const lines: { item: (typeof open.items)[number]; unitPrice: number }[] = [];
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
      weight += item.sku.weightG * item.qty;
      lines.push({ item, unitPrice: current });
    }
    const subtotal = lines.reduce((sum, line) => sum + line.unitPrice * line.item.qty, 0);
    const promo = await this.promotions.preview(input.couponCode, subtotal);
    const quote = await this.shipping.quote(address.state, weight, input.deliveryMethod);
    const shippingTotal = Number(quote.amount);
    const grand = Math.max(0, subtotal - promo.discount + shippingTotal);
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
          contactEmail,
          contactPhone: input.contactPhone ?? address.phone,
          subtotal,
          discountTotal: promo.discount,
          shippingTotal,
          grandTotal: grand,
          couponCode: promo.code,
          deliveryMethod: input.deliveryMethod,
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
              provider: input.paymentMethod === 'paystack' ? 'paystack' : 'bank_transfer',
              providerRef,
              amount: grand,
              currency: 'NGN',
              method: input.paymentMethod,
              status: 'pending',
            },
          },
        },
        include: { items: true, payments: true },
      });
      for (const item of created.items) {
        const stock = await this.inventory.reserve(tx, item.skuId, item.qty);
        await tx.inventoryReservation.create({
          data: {
            inventoryId: stock.id,
            orderItemId: item.id,
            qty: item.qty,
            expiresAt: new Date(Date.now() + 30 * 60_000),
          },
        });
      }
      if (promo.code) await this.promotions.consume(tx, promo.code);
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
    return this.transition(payment.orderId, 'processing', null);
  }

  async transition(id: string, to: OrderState, actorId: string | null) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { items: { include: { reservations: true } } },
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
        }
      }
      if (to === 'dispatched') {
        for (const item of order.items) {
          for (const reservation of item.reservations.filter((row) => row.status === 'active')) {
            await this.inventory.commitSale(tx, reservation.inventoryId, reservation.qty, order.id);
            await tx.inventoryReservation.update({ where: { id: reservation.id }, data: { status: 'committed' } });
          }
        }
        await tx.shipment.create({
          data: {
            orderId: order.id,
            status: 'dispatched',
            shippedAt: new Date(),
            trackingNo: referenceCode('TRK'),
            events: { create: { status: 'dispatched', note: 'Handed to courier' } },
          },
        });
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
      events: shipment.events,
    })),
  };
}
