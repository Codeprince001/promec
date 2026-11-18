import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApiException } from '../../common/api.exception';
import { money } from '../../common/money';
import { availableCredit, decideCredit, dueDate, exposureOf, roundMoney } from '../../domain/credit';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

type Tx = Prisma.TransactionClient;

@Injectable()
export class CreditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async accountFor(userId: string) {
    const customer = await this.prisma.customer.findUnique({ where: { userId } });
    if (!customer) return null;
    const membership = await this.prisma.businessUser.findFirst({
      where: { customerId: customer.id, business: { status: 'approved' } },
      include: { business: true },
      orderBy: { business: { createdAt: 'asc' } },
    });
    if (!membership) return null;
    return { accountId: membership.businessAccountId, discountRate: Number(membership.business.discountRate) };
  }

  async listPrices(accountId: string, skuIds: string[]) {
    const now = new Date();
    const lists = await this.prisma.priceList.findMany({
      where: {
        businessAccountId: accountId,
        status: 'active',
        validFrom: { lte: now },
        OR: [{ validUntil: null }, { validUntil: { gte: now } }],
        items: { some: { skuId: { in: skuIds } } },
      },
      include: { items: { where: { skuId: { in: skuIds } } } },
      orderBy: { createdAt: 'desc' },
    });
    const prices = new Map<string, number>();
    for (const list of lists) {
      for (const item of list.items) {
        if (!prices.has(item.skuId)) prices.set(item.skuId, Number(item.unitPrice));
      }
    }
    return prices;
  }

  async termsFor(userId: string) {
    const customer = await this.prisma.customer.findUnique({ where: { userId } });
    if (!customer) throw new ApiException(HttpStatus.FORBIDDEN, 'CUSTOMER_REQUIRED', 'A customer profile is required');
    const membership = await this.prisma.businessUser.findFirst({
      where: { customerId: customer.id, business: { status: 'approved' } },
      include: { business: true },
      orderBy: { business: { createdAt: 'asc' } },
    });
    if (!membership) {
      throw new ApiException(HttpStatus.CONFLICT, 'CREDIT_NOT_APPROVED', 'This account is not approved for trade credit');
    }
    const exposure = await this.exposure(membership.businessAccountId);
    const limit = Number(membership.business.creditLimit);
    return {
      accountId: membership.businessAccountId,
      legalName: membership.business.legalName,
      discountRate: Number(membership.business.discountRate),
      paymentTermsDays: membership.business.paymentTermsDays,
      spendingLimit: membership.spendingLimit == null ? null : Number(membership.spendingLimit),
      limit,
      exposure,
      available: availableCredit(limit, exposure),
      dueAt: dueDate(membership.business.paymentTermsDays),
    };
  }

  assertAmount(terms: { limit: number; exposure: number; spendingLimit: number | null }, amount: number) {
    this.raise(decideCredit({
      limit: terms.limit,
      exposure: terms.exposure,
      amount,
      spendingLimit: terms.spendingLimit,
    }));
  }

  async position(accountId: string) {
    const account = await this.prisma.businessAccount.findUnique({ where: { id: accountId } });
    if (!account) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Business account was not found');
    const exposure = await this.exposure(accountId);
    const limit = Number(account.creditLimit);
    return {
      id: account.id,
      legalName: account.legalName,
      status: account.status,
      paymentTermsDays: account.paymentTermsDays,
      discountRate: Number(account.discountRate),
      creditLimit: money(limit),
      exposure: money(exposure),
      available: money(availableCredit(limit, exposure)),
    };
  }

  async statement(accountId: string) {
    const position = await this.position(accountId);
    const entries = await this.prisma.creditEntry.findMany({
      where: { businessAccountId: accountId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return {
      account: position,
      entries: entries.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        amount: money(entry.amount),
        reference: entry.reference,
        orderId: entry.orderId,
        note: entry.note,
        createdAt: entry.createdAt.toISOString(),
      })),
    };
  }

  async draw(
    tx: Tx,
    input: { accountId: string; orderId: string; amount: number; reference: string; spendingLimit: number | null },
  ) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(8723462)`;
    const account = await tx.businessAccount.findUnique({ where: { id: input.accountId } });
    if (!account || account.status !== 'approved') {
      throw new ApiException(HttpStatus.CONFLICT, 'CREDIT_NOT_APPROVED', 'This account is not approved for trade credit');
    }
    const decision = decideCredit({
      limit: Number(account.creditLimit),
      exposure: await this.exposure(input.accountId, tx),
      amount: input.amount,
      spendingLimit: input.spendingLimit,
    });
    this.raise(decision);
    await tx.creditEntry.create({
      data: {
        businessAccountId: input.accountId,
        orderId: input.orderId,
        kind: 'order',
        amount: input.amount,
        reference: input.reference,
      },
    });
  }

  async reverse(tx: Tx, orderId: string) {
    const original = await tx.creditEntry.findFirst({ where: { orderId, kind: 'order' } });
    if (!original) return;
    const existing = await tx.creditEntry.findFirst({ where: { orderId, kind: 'reversal' } });
    if (existing) return;
    await tx.creditEntry.create({
      data: {
        businessAccountId: original.businessAccountId,
        orderId,
        kind: 'reversal',
        amount: -Number(original.amount),
        reference: 'cancel',
      },
    });
  }

  async recordPayment(accountId: string, amount: number, reference: string, actorId: string) {
    const applied = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(8723462)`;
      const account = await tx.businessAccount.findUnique({ where: { id: accountId } });
      if (!account) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Business account was not found');
      await tx.creditEntry.create({
        data: { businessAccountId: accountId, kind: 'payment', amount: -roundMoney(amount), reference },
      });
      let remaining = roundMoney(amount);
      const orders = await tx.order.findMany({
        where: { businessAccountId: accountId, paymentStatus: 'pending', status: { not: 'cancelled' } },
        include: { payments: true },
        orderBy: { placedAt: 'asc' },
      });
      const settled: string[] = [];
      for (const order of orders) {
        if (remaining <= 0.001) break;
        const payment = order.payments.find((row) => row.provider === 'account_credit' && row.status === 'pending');
        if (!payment) continue;
        const due = Number(payment.amount);
        if (remaining + 0.001 < due) continue;
        await tx.payment.update({ where: { id: payment.id }, data: { status: 'paid', verifiedAt: new Date() } });
        await tx.order.update({ where: { id: order.id }, data: { paymentStatus: 'paid' } });
        remaining = roundMoney(remaining - due);
        settled.push(order.orderNo);
      }
      return settled;
    });
    await this.audit.log({
      actorId,
      action: 'credit.payment',
      entityType: 'business_account',
      entityId: accountId,
      after: { amount: money(amount), reference, settled: applied },
    });
    return this.statement(accountId);
  }

  private async exposure(accountId: string, tx: Tx | PrismaService = this.prisma) {
    const rows = await tx.creditEntry.findMany({ where: { businessAccountId: accountId }, select: { amount: true } });
    return exposureOf(rows.map((row) => ({ amount: Number(row.amount) })));
  }

  private raise(decision: ReturnType<typeof decideCredit>) {
    if (decision === 'spending_limit') {
      throw new ApiException(HttpStatus.CONFLICT, 'SPENDING_LIMIT', 'This order is above the buyer spending limit');
    }
    if (decision === 'credit_limit') {
      throw new ApiException(HttpStatus.CONFLICT, 'CREDIT_LIMIT', 'This order is above the available trade credit');
    }
  }
}
