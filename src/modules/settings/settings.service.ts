import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { ApiException } from '../../common/api.exception';
import { FieldCipher } from '../../common/crypto/field-cipher.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const KEY = 'platform.settings';

export const patchSchema = z.object({
  storeName: z.string().trim().min(2).max(80).optional(),
  supportEmail: z.union([z.string().email(), z.literal('')]).optional(),
  supportPhone: z.string().trim().max(30).optional(),
  currency: z.string().length(3).optional(),
  paystackPublicKey: z.string().trim().max(200).optional(),
  paystackSecretKey: z.string().trim().max(200).optional(),
  clearPaystackSecret: z.boolean().optional(),
  bankName: z.string().trim().max(80).optional(),
  bankAccountName: z.string().trim().max(120).optional(),
  bankAccountNumber: z.string().trim().max(20).optional(),
  guestCheckout: z.boolean().optional(),
  nlSearch: z.boolean().optional(),
});

export type SettingsPatch = z.infer<typeof patchSchema>;

type Stored = {
  storeName?: string;
  supportEmail?: string;
  supportPhone?: string;
  currency?: string;
  paystackPublicKey?: string;
  paystackSecretCipher?: string;
  paystackSecretLast4?: string;
  bankName?: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
  guestCheckout?: boolean;
  nlSearch?: boolean;
};

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: FieldCipher,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async view() {
    const stored = await this.read();
    const envSecret = this.config.get<string>('PAYSTACK_SECRET_KEY') ?? '';
    const secretSource = stored.paystackSecretCipher ? 'account' : envSecret ? 'environment' : 'missing';
    const bank = await this.bankDetails();
    return {
      storeName: stored.storeName || 'PROMEC',
      supportEmail: stored.supportEmail ?? '',
      supportPhone: stored.supportPhone ?? '',
      currency: stored.currency || 'NGN',
      paystackPublicKey: stored.paystackPublicKey ?? '',
      paystackSecretLast4: stored.paystackSecretLast4 ?? (envSecret ? envSecret.slice(-4) : ''),
      paystackSecretSource: secretSource,
      webhookUrl: `${this.config.get<string>('API_URL') ?? 'http://localhost:4000'}/api/v1/payments/webhooks/paystack`,
      bankName: bank.bankName,
      bankAccountName: bank.accountName,
      bankAccountNumber: bank.accountNumber,
      guestCheckout: await this.guestCheckoutEnabled(),
      nlSearch: await this.nlSearchEnabled(),
    };
  }

  async update(actorId: string, input: SettingsPatch) {
    const stored = await this.read();
    const next: Stored = { ...stored };
    if (input.storeName !== undefined) next.storeName = input.storeName;
    if (input.supportEmail !== undefined) next.supportEmail = input.supportEmail;
    if (input.supportPhone !== undefined) next.supportPhone = input.supportPhone;
    if (input.currency !== undefined) next.currency = input.currency.toUpperCase();
    if (input.paystackPublicKey !== undefined) next.paystackPublicKey = input.paystackPublicKey;
    if (input.bankName !== undefined) next.bankName = input.bankName;
    if (input.bankAccountName !== undefined) next.bankAccountName = input.bankAccountName;
    if (input.bankAccountNumber !== undefined) next.bankAccountNumber = input.bankAccountNumber;
    if (input.guestCheckout !== undefined) next.guestCheckout = input.guestCheckout;
    if (input.nlSearch !== undefined) next.nlSearch = input.nlSearch;
    if (input.clearPaystackSecret) {
      delete next.paystackSecretCipher;
      delete next.paystackSecretLast4;
    }
    if (input.paystackSecretKey) {
      next.paystackSecretCipher = this.cipher.encrypt(input.paystackSecretKey);
      next.paystackSecretLast4 = input.paystackSecretKey.slice(-4);
    }
    await this.write(next);
    await this.audit.log({
      actorId,
      action: 'settings.update',
      entityType: 'platform_settings',
      entityId: KEY,
      after: {
        storeName: next.storeName,
        paystackSecretUpdated: Boolean(input.paystackSecretKey || input.clearPaystackSecret),
        guestCheckout: next.guestCheckout,
        nlSearch: next.nlSearch,
      },
    });
    return this.view();
  }

  async testPaystack() {
    const secret = await this.paystackSecret();
    if (!secret) {
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'NOT_CONFIGURED', 'Add a Paystack secret key before testing the connection');
    }
    const response = await fetch('https://api.paystack.co/balance', {
      headers: { Authorization: `Bearer ${secret}` },
    });
    const json = (await response.json().catch(() => null)) as { status?: boolean; message?: string; data?: { currency: string; balance: number }[] } | null;
    if (!response.ok || json?.status === false) {
      throw new ApiException(HttpStatus.BAD_GATEWAY, 'GATEWAY_ERROR', json?.message || 'Paystack rejected the secret key');
    }
    return {
      ok: true,
      balances: (json?.data ?? []).map((row) => ({
        currency: row.currency,
        amount: (row.balance / 100).toFixed(2),
      })),
    };
  }

  async paystackSecret() {
    const stored = await this.read();
    if (stored.paystackSecretCipher) {
      try {
        return this.cipher.decrypt(stored.paystackSecretCipher);
      } catch {
        return this.config.get<string>('PAYSTACK_SECRET_KEY') ?? '';
      }
    }
    return this.config.get<string>('PAYSTACK_SECRET_KEY') ?? '';
  }

  async bankDetails() {
    const stored = await this.read();
    return {
      accountName: stored.bankAccountName || this.config.get<string>('BANK_ACCOUNT_NAME') || 'PROMEC Limited',
      bankName: stored.bankName || this.config.get<string>('BANK_NAME') || '',
      accountNumber: stored.bankAccountNumber || this.config.get<string>('BANK_ACCOUNT_NUMBER') || '',
    };
  }

  async guestCheckoutEnabled() {
    const stored = await this.read();
    if (typeof stored.guestCheckout === 'boolean') return stored.guestCheckout;
    return this.config.get('FEATURE_GUEST_CHECKOUT') === 'true';
  }

  async nlSearchEnabled() {
    const stored = await this.read();
    if (typeof stored.nlSearch === 'boolean') return stored.nlSearch;
    return this.config.get('FEATURE_NL_SEARCH') === 'true';
  }

  private async read(): Promise<Stored> {
    const row = await this.prisma.featureFlag.findUnique({ where: { key: KEY } });
    if (!row) return {};
    try {
      const parsed = JSON.parse(row.value) as Stored;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private write(value: Stored) {
    const payload = JSON.stringify(value);
    return this.prisma.featureFlag.upsert({
      where: { key: KEY },
      update: { value: payload },
      create: { key: KEY, value: payload },
    });
  }
}
