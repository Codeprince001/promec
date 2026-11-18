import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiException } from '../../common/api.exception';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class PaystackClient {
  constructor(
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
  ) {}

  async initialize(input: { email: string; amountKobo: number; reference: string }) {
    const secret = await this.settings.paystackSecret();
    if (!secret) return { authorizationUrl: null as string | null };
    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        email: input.email,
        amount: input.amountKobo,
        reference: input.reference,
        callback_url: `${this.config.get<string>('APP_URL')}/orders`,
      }),
    });
    if (!response.ok) {
      throw new ApiException(HttpStatus.BAD_GATEWAY, 'GATEWAY_ERROR', 'Could not start the payment');
    }
    const json = (await response.json()) as { data?: { authorization_url?: string } };
    return { authorizationUrl: json.data?.authorization_url ?? null };
  }

  async verify(reference: string) {
    const secret = await this.settings.paystackSecret();
    if (!secret) return { configured: false as const, status: 'unconfigured', amount: null as number | null };
    const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    if (!response.ok) return { configured: true as const, status: 'missing', amount: null as number | null };
    const json = (await response.json()) as { data?: { status?: string; amount?: number } };
    return {
      configured: true as const,
      status: json.data?.status ?? 'unknown',
      amount: json.data?.amount == null ? null : json.data.amount / 100,
    };
  }

  async refund(reference: string, amountNaira: number) {
    const secret = await this.settings.paystackSecret();
    if (!secret) {
      if (this.config.get('NODE_ENV') === 'production') {
        throw new ApiException(HttpStatus.BAD_GATEWAY, 'GATEWAY_ERROR', 'Payment provider is not configured');
      }
      return;
    }
    const response = await fetch('https://api.paystack.co/refund', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ transaction: reference, amount: Math.round(amountNaira * 100) }),
    });
    if (!response.ok) {
      throw new ApiException(HttpStatus.BAD_GATEWAY, 'GATEWAY_ERROR', 'The payment provider rejected the refund');
    }
  }
}
