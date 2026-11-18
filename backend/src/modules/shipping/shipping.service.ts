import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'crypto';
import { ApiException } from '../../common/api.exception';
import { money, moneyNumber } from '../../common/money';
import { OutboxService } from '../../infra/outbox.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CarrierGateway } from './couriers/carriers';
import { quoteCouriers, type CourierOffer } from './couriers/rates';

type Tx = Prisma.TransactionClient;

@Injectable()
export class ShippingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly carriers: CarrierGateway,
  ) {}

  offers(state: string, weightG: number): CourierOffer[] {
    return quoteCouriers(state, weightG);
  }

  async quote(state: string, weightG: number, method: 'courier' | 'pickup', courierCode?: string) {
    if (method === 'pickup') {
      return { method, amount: '0.00', currency: 'NGN' as const, zone: 'Warehouse pickup', courier: null, etaDays: 0, couriers: [] as CourierOffer[] };
    }
    const couriers = await this.liveOffers(state, weightG);
    const chosen = courierCode ? couriers.find((offer) => offer.courier === courierCode) : couriers[0];
    if (courierCode && !chosen) {
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_ERROR', 'That courier does not serve this shipment');
    }
    const zones = await this.prisma.deliveryZone.findMany({ where: { isActive: true } });
    const match = zones.find((zone) => zone.states.some((item) => item.toLowerCase() === state.toLowerCase()))
      ?? zones.find((zone) => zone.name === 'Nationwide');
    const kg = Math.max(weightG / 1000, 0.5);
    const fallback = match ? moneyNumber(match.baseFee) + moneyNumber(match.perKgFee) * kg : 3500;
    return {
      method,
      amount: chosen?.amount ?? money(fallback),
      currency: 'NGN' as const,
      zone: match?.name ?? 'Standard',
      courier: chosen?.courier ?? null,
      etaDays: chosen?.etaDays ?? null,
      couriers,
    };
  }

  async book(
    tx: Tx,
    input: { orderId: string; orderNo: string; address: Prisma.JsonValue | null; weightG: number; value: number; courierCode?: string | null; fee: number; warehouseId?: string | null },
  ) {
    if (!input.warehouseId) {
      return tx.shipment.create({
        data: {
          orderId: input.orderId,
          status: 'awaiting_vendor',
          fee: input.fee,
          events: { create: { status: 'awaiting_vendor', note: 'The vendor ships this part from their own stock', source: 'vendor' } },
        },
      });
    }
    const address = readAddress(input.address);
    const chosen = input.courierCode
      ? quoteCouriers(address.state, input.weightG).find((offer) => offer.courier === input.courierCode)
      : quoteCouriers(address.state, input.weightG)[0];
    const courier = chosen?.courier ?? 'gig';
    const live = await this.purchase(courier, { ...input, address });
    return tx.shipment.create({
      data: {
        orderId: input.orderId,
        warehouseId: input.warehouseId,
        courierName: courier,
        trackingNo: live.trackingNo,
        labelUrl: live.labelUrl,
        carrierRef: live.carrierRef,
        status: live.trackingNo ? 'dispatched' : 'awaiting_carrier',
        fee: input.fee,
        shippedAt: live.trackingNo ? new Date() : null,
        events: {
          create: {
            status: live.trackingNo ? 'booked' : 'awaiting_carrier',
            note: live.trackingNo ? `${courier.toUpperCase()} accepted the shipment` : `${courier.toUpperCase()} credentials are not configured, so no waybill was created`,
            source: courier,
          },
        },
      },
    });
  }

  async retryBooking(shipmentId: string) {
    const shipment = await this.prisma.shipment.findUnique({ where: { id: shipmentId }, include: { order: true } });
    if (!shipment) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Shipment was not found');
    if (shipment.trackingNo) return this.track(shipment.trackingNo);
    const courier = shipment.courierName === 'dhl' ? 'dhl' : 'gig';
    const live = await this.purchase(courier, {
      orderNo: shipment.order.orderNo,
      address: readAddress(shipment.order.shippingAddress),
      weightG: 1000,
      value: Number(shipment.order.grandTotal),
    });
    if (!live.trackingNo) throw new ApiException(HttpStatus.CONFLICT, 'CARRIER_NOT_CONFIGURED', `${courier.toUpperCase()} did not return a waybill`);
    await this.prisma.shipment.update({
      where: { id: shipment.id },
      data: { trackingNo: live.trackingNo, labelUrl: live.labelUrl, carrierRef: live.carrierRef, status: 'dispatched', shippedAt: new Date() },
    });
    return this.track(live.trackingNo);
  }

  private async liveOffers(state: string, weightG: number): Promise<CourierOffer[]> {
    const local = this.offers(state, weightG);
    return Promise.all(local.map(async (offer) => {
      const live = await this.carriers.quote(offer.courier, { state, weightKg: Math.max(weightG / 1000, 0.5), value: 0 }).catch(() => null);
      return live ? { ...offer, amount: money(live.amount), source: 'carrier' as const } : { ...offer, source: 'tariff' as const };
    }));
  }

  private async purchase(courier: 'gig' | 'dhl', input: { orderNo: string; address: ReturnType<typeof readAddress>; weightG: number; value: number }) {
    try {
      const live = await this.carriers.book(courier, {
        orderNo: input.orderNo,
        state: input.address.state,
        street: input.address.street,
        recipient: input.address.name,
        phone: input.address.phone,
        senderPhone: input.address.phone,
        weightKg: Math.max(input.weightG / 1000, 0.5),
        value: input.value,
      });
      if (live.configured && !live.trackingNo) {
        throw new ApiException(HttpStatus.BAD_GATEWAY, 'GATEWAY_ERROR', `${courier.toUpperCase()} accepted the call but returned no waybill`);
      }
      return live;
    } catch (error) {
      if (error instanceof ApiException) throw error;
      throw new ApiException(HttpStatus.BAD_GATEWAY, 'GATEWAY_ERROR', error instanceof Error ? error.message : 'Carrier booking failed');
    }
  }

  async listAdmin() {
    const rows = await this.prisma.shipment.findMany({
      include: { order: { select: { orderNo: true } } },
      orderBy: { shippedAt: 'desc' },
      take: 100,
    });
    return rows.map((row) => ({
      id: row.id,
      orderId: row.orderId,
      orderNo: row.order.orderNo,
      status: row.status,
      courier: row.courierName,
      trackingNo: row.trackingNo,
      labelUrl: row.labelUrl,
      warehouseId: row.warehouseId,
    }));
  }

  async track(trackingNo: string) {
    const shipment = await this.prisma.shipment.findFirst({
      where: { trackingNo },
      include: { events: { orderBy: { occurredAt: 'asc' } } },
    });
    if (!shipment) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Tracking number was not found');
    return {
      trackingNo: shipment.trackingNo,
      courier: shipment.courierName,
      status: shipment.status,
      events: shipment.events.map((event) => ({
        status: event.status,
        note: event.note,
        location: event.location,
        occurredAt: event.occurredAt.toISOString(),
      })),
    };
  }

  async applyEvent(courier: string, trackingNo: string, status: string, note?: string) {
    const known = new Set(['in_transit', 'out_for_delivery', 'delivered', 'exception']);
    if (!known.has(status)) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_ERROR', 'Unknown tracking status');
    const shipment = await this.prisma.shipment.findFirst({ where: { trackingNo, courierName: courier } });
    if (!shipment) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Tracking number was not found');
    if (shipment.status === status) return this.track(trackingNo);
    await this.prisma.$transaction(async (tx) => {
      await tx.shipmentEvent.create({ data: { shipmentId: shipment.id, status, note, source: courier } });
      await tx.shipment.update({
        where: { id: shipment.id },
        data: {
          status,
          ...(status === 'delivered' ? { deliveredAt: new Date() } : {}),
        },
      });
      if (status === 'delivered') {
        await this.outbox.append(tx, {
          aggregateType: 'shipment',
          aggregateId: shipment.id,
          eventType: 'shipment.delivered',
          payload: { orderId: shipment.orderId, shipmentId: shipment.id },
        });
      }
    });
    return this.track(trackingNo);
  }

  listZones() {
    return this.prisma.deliveryZone.findMany({ orderBy: { name: 'asc' } });
  }

  createZone(input: { name: string; states: string[]; baseFee: number; perKgFee: number; currency?: string; isActive?: boolean }) {
    return this.prisma.deliveryZone.create({
      data: {
        name: input.name,
        states: input.states,
        baseFee: input.baseFee,
        perKgFee: input.perKgFee,
        currency: input.currency ?? 'NGN',
        isActive: input.isActive ?? true,
      },
    });
  }

  async updateZone(id: string, input: { name?: string; states?: string[]; baseFee?: number; perKgFee?: number; isActive?: boolean }) {
    const current = await this.prisma.deliveryZone.findUnique({ where: { id } });
    if (!current) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Delivery zone was not found');
    return this.prisma.deliveryZone.update({ where: { id }, data: input });
  }

  assertWebhook(secret: string, rawBody: Buffer | undefined, signature: string | undefined, production = false) {
    if (!secret) {
      if (production) throw new ApiException(HttpStatus.UNAUTHORIZED, 'INVALID_SIGNATURE', 'Courier webhook secret is not configured');
      return;
    }
    const digest = createHmac('sha256', secret).update(rawBody ?? Buffer.alloc(0)).digest('hex');
    const left = Buffer.from(digest);
    const right = Buffer.from(signature ?? '');
    if (left.length !== right.length || !timingSafeEqual(left, right)) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, 'INVALID_SIGNATURE', 'Courier webhook signature did not match');
    }
  }
}

function readAddress(value: Prisma.JsonValue | null) {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const text = (key: string, fallback: string) => (typeof record[key] === 'string' && record[key] ? String(record[key]) : fallback);
  return { state: text('state', 'Lagos'), street: text('street', 'Lagos'), name: text('fullName', 'Customer'), phone: text('phone', '08000000000') };
}
