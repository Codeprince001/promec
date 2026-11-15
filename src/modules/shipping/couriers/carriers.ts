import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseDhlBooking, parseDhlRate, parseGigBooking } from '../../../domain/operations';

export type LiveQuote = { amount: number; currency: string; productCode?: string } | null;
export type LiveBooking = { trackingNo: string | null; labelUrl: string | null; carrierRef: string | null; configured: boolean };

@Injectable()
export class CarrierGateway {
  private gigToken?: { value: string; expiresAt: number };

  constructor(private readonly config: ConfigService) {}

  gigConfigured() {
    return Boolean(this.config.get<string>('GIG_EMAIL') && this.config.get<string>('GIG_PASSWORD'));
  }

  dhlConfigured() {
    return Boolean(this.config.get<string>('DHL_API_KEY') && this.config.get<string>('DHL_API_SECRET') && this.config.get<string>('DHL_ACCOUNT_NUMBER'));
  }

  async quote(courier: 'gig' | 'dhl', input: { state: string; weightKg: number; value: number }): Promise<LiveQuote> {
    if (courier === 'gig' && this.gigConfigured()) return this.gigPrice(input.weightKg, input.value);
    if (courier === 'dhl' && this.dhlConfigured()) return this.dhlPrice(input);
    return null;
  }

  async book(courier: 'gig' | 'dhl', input: BookingInput): Promise<LiveBooking> {
    if (courier === 'gig') {
      if (!this.gigConfigured()) return { trackingNo: null, labelUrl: null, carrierRef: null, configured: false };
      const booked = await this.gigDropOff(input);
      return { ...booked, carrierRef: booked.trackingNo, configured: true };
    }
    if (!this.dhlConfigured()) return { trackingNo: null, labelUrl: null, carrierRef: null, configured: false };
    const booked = await this.dhlShipment(input);
    return { ...booked, carrierRef: booked.trackingNo, configured: true };
  }

  private async gigPrice(weightKg: number, value: number): Promise<LiveQuote> {
    const station = Number(this.config.get<string>('GIG_SENDER_STATION_ID') || '0');
    const body = await this.gig('POST', '/dropOff/price', {
      SenderStationId: station,
      ReceiverStationId: station,
      DeliveryType: 0,
      PickUpOptions: 0,
      ShipmentItems: [{ ItemName: 'Auto part', Description: 'Automotive part', Quantity: 1, Weight: Math.max(weightKg, 0.5), IsVolumetric: false, ShipmentType: 1, Value: value }],
    });
    const nested = asRecord(asRecord(body.data)?.data) ?? asRecord(body.data) ?? body;
    const total = Number(nested.GrandTotal ?? nested.DeliverPrice);
    return Number.isFinite(total) && total > 0 ? { amount: total, currency: 'NGN' } : null;
  }

  private async gigDropOff(input: BookingInput) {
    const station = Number(this.config.get<string>('GIG_SENDER_STATION_ID') || '0');
    const body = await this.gig('POST', '/create/dropOff', {
      TempCode: input.orderNo,
      SenderDetails: { Name: 'PROMEC Limited', Phone: input.senderPhone, Address: 'Lagos warehouse', StationId: station },
      ReceiverDetails: { Name: input.recipient, Phone: input.phone, Address: input.street, StationId: station, City: input.state },
      ShipmentDetails: { DeliveryType: 0, PickUpOptions: 0 },
      ShipmentItems: [{ ItemName: 'Auto part', Description: input.orderNo, Quantity: 1, Weight: Math.max(input.weightKg, 0.5), IsVolumetric: false, ShipmentType: 1, Value: input.value }],
    });
    return parseGigBooking(body);
  }

  private async gig(method: string, path: string, payload?: unknown) {
    const token = await this.gigAccessToken();
    const response = await fetch(`${this.gigBase()}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'access-token': token },
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) throw new Error(`GIG ${path} failed (${response.status})`);
    return json;
  }

  private async gigAccessToken() {
    if (this.gigToken && this.gigToken.expiresAt > Date.now()) return this.gigToken.value;
    const response = await fetch(`${this.gigBase()}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: this.config.get('GIG_EMAIL'), password: this.config.get('GIG_PASSWORD') }),
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const data = asRecord(asRecord(json.data)?.data) ?? asRecord(json.data) ?? json;
    const token = typeof data['access-token'] === 'string' ? data['access-token'] : '';
    if (!response.ok || !token) throw new Error('GIG login failed');
    this.gigToken = { value: token, expiresAt: Date.now() + 30 * 60_000 };
    return token;
  }

  private async dhlPrice(input: { state: string; weightKg: number }): Promise<LiveQuote> {
    const body = await this.dhl('POST', '/rates', this.dhlRateBody(input.state, input.weightKg));
    const parsed = parseDhlRate(body);
    return parsed ? { amount: parsed.amount, currency: parsed.currency, productCode: parsed.productCode } : null;
  }

  private async dhlShipment(input: BookingInput) {
    const rated = await this.dhlPrice({ state: input.state, weightKg: input.weightKg });
    const body = await this.dhl('POST', '/shipments', {
      ...this.dhlRateBody(input.state, input.weightKg),
      productCode: rated?.productCode ?? 'N',
      customerReferences: [{ value: input.orderNo, typeCode: 'CU' }],
      content: { description: `PROMEC order ${input.orderNo}`, unitOfMeasurement: 'metric', isCustomsDeclarable: false, packages: this.packages(input.weightKg) },
    });
    return parseDhlBooking(body);
  }

  private dhlRateBody(state: string, weightKg: number) {
    const planned = new Date(Date.now() + 60 * 60_000).toISOString().replace(/\.\d{3}Z$/, 'GMT+01:00');
    return {
      customerDetails: {
        shipperDetails: { postalCode: '100001', cityName: 'Lagos', countryCode: 'NG', addressLine1: 'PROMEC warehouse' },
        receiverDetails: { postalCode: '000001', cityName: state, countryCode: 'NG', addressLine1: state },
      },
      accounts: [{ typeCode: 'shipper', number: this.config.get<string>('DHL_ACCOUNT_NUMBER') }],
      plannedShippingDateAndTime: planned,
      unitOfMeasurement: 'metric',
      isCustomsDeclarable: false,
      packages: this.packages(weightKg),
    };
  }

  private packages(weightKg: number) {
    return [{ weight: Math.max(weightKg, 0.5), dimensions: { length: 20, width: 15, height: 10 } }];
  }

  private async dhl(method: string, path: string, payload: unknown) {
    const key = this.config.get<string>('DHL_API_KEY') ?? '';
    const secret = this.config.get<string>('DHL_API_SECRET') ?? '';
    const response = await fetch(`${(this.config.get<string>('DHL_API_BASE') ?? '').replace(/\/$/, '')}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`,
        'content-type': 'application/json',
        'Message-Reference': crypto.randomUUID(),
        'Message-Reference-Date': new Date().toUTCString(),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) throw new Error(`DHL ${path} failed (${response.status})`);
    return json;
  }

  private gigBase() {
    return (this.config.get<string>('GIG_API_BASE') ?? '').replace(/\/$/, '');
  }
}

type BookingInput = {
  orderNo: string;
  state: string;
  street: string;
  recipient: string;
  phone: string;
  senderPhone: string;
  weightKg: number;
  value: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
