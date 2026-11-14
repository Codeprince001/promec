import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiException } from '../../common/api.exception';
import { money } from '../../common/money';
import { AuditService } from '../audit/audit.service';
import { OrdersService } from '../orders/orders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PaystackClient } from './paystack.client';
import { paystackSignature, signaturesMatch } from './paystack.signature';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly orders: OrdersService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly paystack: PaystackClient,
  ) {}

  async handleWebhook(
    rawBody: Buffer | undefined,
    signature: string | undefined,
    body: { event: string; data: { reference: string; amount: number } },
  ) {
    const secret = this.config.get<string>('PAYSTACK_SECRET_KEY') ?? '';
    if (secret) {
      if (!rawBody || !signaturesMatch(paystackSignature(secret, rawBody), signature)) {
        throw new ApiException(HttpStatus.UNAUTHORIZED, 'INVALID_SIGNATURE', 'Webhook signature did not match');
      }
    } else if (this.config.get('NODE_ENV') === 'production') {
      throw new ApiException(HttpStatus.UNAUTHORIZED, 'INVALID_SIGNATURE', 'Payment webhook secret is not configured');
    }
    if (body.event !== 'charge.success') return { ignored: true };
    return this.orders.markPaid(body.data.reference, body.data.amount / 100, body);
  }

  async initialize(reference: string) {
    const payment = await this.prisma.payment.findUnique({ where: { providerRef: reference }, include: { order: true } });
    if (!payment) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Payment reference was not found');
    if (payment.provider !== 'paystack') {
      throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'This payment is not collected by Paystack');
    }
    if (!payment.order.contactEmail) {
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_ERROR', 'The order has no email for the payment provider');
    }
    const started = await this.paystack.initialize({
      email: payment.order.contactEmail,
      amountKobo: Math.round(Number(payment.amount) * 100),
      reference,
    });
    return { reference, authorizationUrl: started.authorizationUrl, amount: money(payment.amount) };
  }

  async simulate(reference: string) {
    if (this.config.get('NODE_ENV') === 'production') {
      throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
    }
    const payment = await this.prisma.payment.findUnique({ where: { providerRef: reference } });
    if (!payment) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Payment reference was not found');
    return this.orders.markPaid(reference, Number(payment.amount));
  }

  async confirm(reference: string) {
    const payment = await this.prisma.payment.findUnique({ where: { providerRef: reference } });
    if (!payment) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Payment reference was not found');
    return this.orders.markPaid(reference, Number(payment.amount));
  }

  async refund(actorId: string, paymentId: string, amount: number, reason: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId }, include: { refunds: true } });
    if (!payment || payment.status === 'pending' || payment.status === 'failed') {
      throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'Only a successful payment can be refunded');
    }
    const already = payment.refunds.reduce((sum, refund) => sum + Number(refund.amount), 0);
    if (already + amount > Number(payment.amount) + 0.001) {
      throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'Refund exceeds the amount paid');
    }
    if (payment.provider === 'paystack' && payment.providerRef) {
      await this.paystack.refund(payment.providerRef, amount);
    }
    const refund = await this.prisma.refund.create({
      data: { paymentId: payment.id, orderId: payment.orderId, amount, reason, status: 'paid', approvedBy: actorId },
    });
    const fully = already + amount >= Number(payment.amount) - 0.001;
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { status: fully ? 'refunded' : 'partially_refunded' },
    });
    await this.audit.log({
      actorId,
      action: 'refund.approve',
      entityType: 'payment',
      entityId: payment.id,
      after: { amount: money(amount), reason },
    });
    return refund;
  }
}
