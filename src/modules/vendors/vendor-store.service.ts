import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ApiException } from '../../common/api.exception';
import { money } from '../../common/money';
import { pageMeta } from '../../common/pagination';
import { MIN_VENDOR_WITHDRAWAL, withdrawableBalance } from '../../domain/commerce';
import { slugify } from '../../domain/slug';
import { PrismaService } from '../../prisma/prisma.service';
import { presentProduct, productInclude } from '../catalogue/catalogue.service';
import { AuditService } from '../audit/audit.service';

const RESERVED_SLUGS = new Set(['apply', 'admin', 'new', 'edit', 'api', 'vendor', 'vendors']);
const REVIEWABLE = ['delivered', 'completed', 'return_requested', 'returned'] as const;

const optionalText = (max: number) => z.string().trim().max(max).optional();
const optionalHttps = z
  .string()
  .trim()
  .max(500)
  .optional()
  .refine((value) => value == null || value === '' || /^https:\/\/\S+$/.test(value), 'Use an https address');

export const storeProfileSchema = z.object({
  businessName: z.string().trim().min(2).max(160).optional(),
  slug: z.string().trim().min(3).max(70).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  logoUrl: optionalHttps,
  bannerUrl: optionalHttps,
  description: optionalText(2000),
  phone: z.string().trim().min(10).max(20).optional(),
  addressLine: optionalText(160),
  city: optionalText(80),
  state: optionalText(80),
  country: z.string().trim().length(2).optional(),
  policies: optionalText(4000),
  payoutBankName: optionalText(80),
  payoutAccountName: optionalText(120),
  payoutAccountNumber: z.string().trim().regex(/^\d{10}$/).optional(),
});

export const applySchema = storeProfileSchema.extend({
  businessName: z.string().trim().min(2).max(160),
});

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(48).default(24),
  q: z.string().trim().max(80).optional(),
});

export type StoreProfile = z.infer<typeof storeProfileSchema>;

@Injectable()
export class VendorStoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async apply(userId: string, input: z.infer<typeof applySchema>) {
    const existing = await this.prisma.vendor.findUnique({ where: { userId } });
    if (existing) throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'A vendor application already exists');
    const vendor = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { userType: 'vendor' } });
      return tx.vendor.create({
        data: {
          userId,
          businessName: input.businessName,
          slug: await this.claimSlug(tx, input.slug ?? slugify(input.businessName)),
          ...this.profileData(input),
        },
      });
    });
    await this.audit.log({
      actorId: userId,
      action: 'vendor.apply',
      entityType: 'vendor',
      entityId: vendor.id,
      after: { businessName: vendor.businessName, slug: vendor.slug },
    });
    return this.presentPrivate(vendor);
  }

  async mine(userId: string) {
    const vendor = await this.prisma.vendor.findUnique({ where: { userId } });
    if (!vendor) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Open a store before managing it');
    return { ...this.presentPrivate(vendor), balance: await this.balance(vendor.id) };
  }

  async update(userId: string, input: StoreProfile) {
    const vendor = await this.prisma.vendor.findUnique({ where: { userId } });
    if (!vendor) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Open a store before managing it');
    if (vendor.status === 'rejected') {
      throw new ApiException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'This store application was rejected');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const slug = input.slug && input.slug !== vendor.slug ? await this.claimSlug(tx, input.slug, vendor.id) : undefined;
      return tx.vendor.update({
        where: { id: vendor.id },
        data: {
          ...(input.businessName ? { businessName: input.businessName } : {}),
          ...(slug ? { slug } : {}),
          ...this.profileData(input),
        },
      });
    });
    await this.audit.log({
      actorId: userId,
      action: 'vendor.store.update',
      entityType: 'vendor',
      entityId: vendor.id,
      after: { slug: updated.slug, businessName: updated.businessName, accountLast4: last4(updated.payoutAccountNumber) },
    });
    return { ...this.presentPrivate(updated), balance: await this.balance(updated.id) };
  }

  async listPublic(query: z.infer<typeof pageQuery>) {
    const where: Prisma.VendorWhereInput = {
      status: 'approved',
      ...(query.q ? { businessName: { contains: query.q, mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.vendor.findMany({
        where,
        orderBy: [{ ratingCount: 'desc' }, { businessName: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.vendor.count({ where }),
    ]);
    return { data: rows.map((row) => this.presentPublic(row)), meta: pageMeta(query.page, query.pageSize, total) };
  }

  async publicStore(slug: string) {
    const vendor = await this.approvedBySlug(slug);
    return this.presentPublic(vendor);
  }

  async publicProducts(slug: string, query: { page: number; pageSize: number }) {
    const vendor = await this.approvedBySlug(slug);
    const where: Prisma.ProductWhereInput = { vendorId: vendor.id, status: 'published', deletedAt: null };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        include: productInclude,
        orderBy: { name: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.product.count({ where }),
    ]);
    return { data: rows.map(presentProduct), meta: pageMeta(query.page, query.pageSize, total) };
  }

  async publicReviews(slug: string, query: { page: number; pageSize: number }) {
    const vendor = await this.approvedBySlug(slug);
    const where = { vendorId: vendor.id, hidden: false };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.vendorReview.findMany({
        where,
        include: { customer: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.vendorReview.count({ where }),
    ]);
    return {
      data: rows.map((row) => ({
        id: row.id,
        rating: row.rating,
        comment: row.comment,
        createdAt: row.createdAt,
        author: displayName(row.customer.firstName, row.customer.lastName),
      })),
      meta: pageMeta(query.page, query.pageSize, total),
    };
  }

  async review(userId: string, slug: string, input: { orderNo: string; rating: number; comment?: string }) {
    const vendor = await this.approvedBySlug(slug);
    const customer = await this.prisma.customer.findUnique({ where: { userId } });
    if (!customer) throw new ApiException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'A customer account can rate a store');
    const order = await this.prisma.order.findFirst({
      where: {
        orderNo: input.orderNo,
        customerId: customer.id,
        paymentStatus: { in: ['paid', 'partially_refunded'] },
        status: { in: [...REVIEWABLE] },
        items: { some: { sku: { product: { vendorId: vendor.id } } } },
      },
    });
    if (!order) {
      throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'Rate a store from a delivered order that included its parts');
    }
    const existing = await this.prisma.vendorReview.findUnique({ where: { vendorId_orderId: { vendorId: vendor.id, orderId: order.id } } });
    if (existing) throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'This order already has a rating for the store');
    const comment = input.comment?.trim() || null;
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.vendorReview.create({
        data: { vendorId: vendor.id, orderId: order.id, customerId: customer.id, rating: input.rating, comment },
      });
      const summary = await tx.vendorReview.aggregate({ where: { vendorId: vendor.id, hidden: false }, _avg: { rating: true }, _count: true });
      await tx.vendor.update({
        where: { id: vendor.id },
        data: { ratingAvg: summary._avg.rating ?? 0, ratingCount: summary._count },
      });
      return { id: created.id, rating: created.rating, comment: created.comment, createdAt: created.createdAt };
    });
  }

  async setReviewHidden(actorId: string, id: string, hidden: boolean) {
    const review = await this.prisma.vendorReview.findUnique({ where: { id } });
    if (!review) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Review was not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.vendorReview.update({ where: { id }, data: { hidden } });
      const summary = await tx.vendorReview.aggregate({ where: { vendorId: review.vendorId, hidden: false }, _avg: { rating: true }, _count: true });
      await tx.vendor.update({
        where: { id: review.vendorId },
        data: { ratingAvg: summary._avg.rating ?? 0, ratingCount: summary._count },
      });
    });
    await this.audit.log({ actorId, action: hidden ? 'review.hide' : 'review.restore', entityType: 'vendor_review', entityId: id, after: { hidden } });
    return { id, hidden };
  }

  async requestWithdrawal(userId: string, amount: number, note?: string) {
    if (amount < MIN_VENDOR_WITHDRAWAL) {
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_ERROR', `The smallest withdrawal is NGN ${MIN_VENDOR_WITHDRAWAL}`);
    }
    const vendor = await this.prisma.vendor.findUnique({ where: { userId } });
    if (!vendor || vendor.status !== 'approved') {
      throw new ApiException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Only an approved store can withdraw');
    }
    if (!vendor.payoutBankName || !vendor.payoutAccountName || !vendor.payoutAccountNumber) {
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_ERROR', 'Add a payout account before requesting a withdrawal');
    }
    const entry = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM vendors WHERE id = ${vendor.id} FOR UPDATE`;
      const available = await this.availableIn(tx, vendor.id);
      if (amount > available + 0.001) {
        throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'Withdrawal is higher than the amount still available');
      }
      return tx.vendorWithdrawal.create({
        data: {
          vendorId: vendor.id,
          amount,
          note: note?.trim() || null,
          bankName: vendor.payoutBankName!,
          accountName: vendor.payoutAccountName!,
          accountNumber: vendor.payoutAccountNumber!,
        },
      });
    });
    await this.audit.log({
      actorId: userId,
      action: 'vendor.withdrawal.request',
      entityType: 'vendor_withdrawal',
      entityId: entry.id,
      after: { amount, accountLast4: last4(entry.accountNumber) },
    });
    return this.presentWithdrawal(entry);
  }

  async myWithdrawals(userId: string) {
    const vendor = await this.prisma.vendor.findUnique({ where: { userId } });
    if (!vendor) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Open a store before managing it');
    const rows = await this.prisma.vendorWithdrawal.findMany({ where: { vendorId: vendor.id }, orderBy: { requestedAt: 'desc' }, take: 50 });
    return { balance: await this.balance(vendor.id), withdrawals: rows.map((row) => this.presentWithdrawal(row)) };
  }

  async adminWithdrawals(status?: string) {
    const rows = await this.prisma.vendorWithdrawal.findMany({
      where: status ? { status } : {},
      include: { vendor: { select: { id: true, businessName: true, slug: true } } },
      orderBy: { requestedAt: 'desc' },
      take: 100,
    });
    return rows.map((row) => ({ ...this.presentWithdrawal(row), vendor: row.vendor }));
  }

  async decide(actorId: string, id: string, action: 'approve' | 'reject' | 'pay', reference?: string) {
    const paid = await this.prisma.$transaction(async (tx) => {
      const row = await tx.vendorWithdrawal.findUnique({ where: { id } });
      if (!row) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Withdrawal was not found');
      if (row.status === 'paid' || row.status === 'rejected') {
        throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'This withdrawal is already closed');
      }
      if (action === 'approve') {
        if (row.status !== 'requested') throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'Only a new request can be approved');
        return tx.vendorWithdrawal.update({ where: { id }, data: { status: 'approved', decidedAt: new Date(), decidedBy: actorId } });
      }
      if (action === 'reject') {
        return tx.vendorWithdrawal.update({ where: { id }, data: { status: 'rejected', decidedAt: new Date(), decidedBy: actorId } });
      }
      if (row.status !== 'approved') throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'Approve the withdrawal before paying it');
      if (!reference) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_ERROR', 'A bank reference is required to pay a withdrawal');
      await tx.$executeRaw`SELECT id FROM vendors WHERE id = ${row.vendorId} FOR UPDATE`;
      const ledger = await tx.vendorLedger.aggregate({ where: { vendorId: row.vendorId }, _sum: { amount: true } });
      const open = Number(ledger._sum.amount ?? 0);
      if (Number(row.amount) > open + 0.001) {
        throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'The store balance no longer covers this withdrawal');
      }
      await tx.vendorLedger.create({
        data: { vendorId: row.vendorId, kind: 'payout', amount: -Number(row.amount), reference },
      });
      return tx.vendorWithdrawal.update({
        where: { id },
        data: { status: 'paid', reference, decidedAt: new Date(), decidedBy: actorId },
      });
    });
    await this.audit.log({
      actorId,
      action: `vendor.withdrawal.${action}`,
      entityType: 'vendor_withdrawal',
      entityId: id,
      after: { status: paid.status, reference: paid.reference },
    });
    return this.presentWithdrawal(paid);
  }

  private async approvedBySlug(slug: string) {
    const vendor = await this.prisma.vendor.findUnique({ where: { slug } });
    if (!vendor || vendor.status !== 'approved') {
      throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Store was not found');
    }
    return vendor;
  }

  private async claimSlug(tx: Prisma.TransactionClient, slug: string, exceptId?: string) {
    const value = slug.trim().toLowerCase();
    if (RESERVED_SLUGS.has(value)) throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'That store link is reserved');
    const taken = await tx.vendor.findFirst({ where: { slug: value, ...(exceptId ? { NOT: { id: exceptId } } : {}) } });
    if (taken) throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'That store link is already in use');
    return value;
  }

  private profileData(input: StoreProfile) {
    const data: {
      logoUrl?: string | null;
      bannerUrl?: string | null;
      description?: string | null;
      phone?: string | null;
      addressLine?: string | null;
      city?: string | null;
      state?: string | null;
      country?: string;
      policies?: string | null;
      payoutBankName?: string | null;
      payoutAccountName?: string | null;
      payoutAccountNumber?: string | null;
    } = {
      ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl || null } : {}),
      ...(input.bannerUrl !== undefined ? { bannerUrl: input.bannerUrl || null } : {}),
      ...(input.description !== undefined ? { description: input.description || null } : {}),
      ...(input.phone !== undefined ? { phone: input.phone || null } : {}),
      ...(input.addressLine !== undefined ? { addressLine: input.addressLine || null } : {}),
      ...(input.city !== undefined ? { city: input.city || null } : {}),
      ...(input.state !== undefined ? { state: input.state || null } : {}),
      ...(input.country !== undefined ? { country: input.country.toUpperCase() } : {}),
      ...(input.policies !== undefined ? { policies: input.policies || null } : {}),
      ...(input.payoutBankName !== undefined ? { payoutBankName: input.payoutBankName || null } : {}),
      ...(input.payoutAccountName !== undefined ? { payoutAccountName: input.payoutAccountName || null } : {}),
      ...(input.payoutAccountNumber !== undefined ? { payoutAccountNumber: input.payoutAccountNumber || null } : {}),
    };
    return data;
  }

  private async balance(vendorId: string) {
    const [ledger, reserved] = await this.prisma.$transaction([
      this.prisma.vendorLedger.aggregate({ where: { vendorId }, _sum: { amount: true } }),
      this.prisma.vendorWithdrawal.aggregate({ where: { vendorId, status: { in: ['requested', 'approved'] } }, _sum: { amount: true } }),
    ]);
    const ledgerBalance = Number(ledger._sum.amount ?? 0);
    const held = Number(reserved._sum.amount ?? 0);
    return { ledger: money(ledgerBalance), reserved: money(held), available: money(withdrawableBalance(ledgerBalance, held)) };
  }

  private async availableIn(tx: Prisma.TransactionClient, vendorId: string) {
    const ledger = await tx.vendorLedger.aggregate({ where: { vendorId }, _sum: { amount: true } });
    const reserved = await tx.vendorWithdrawal.aggregate({
      where: { vendorId, status: { in: ['requested', 'approved'] } },
      _sum: { amount: true },
    });
    return withdrawableBalance(Number(ledger._sum.amount ?? 0), Number(reserved._sum.amount ?? 0));
  }

  private presentPublic(vendor: Prisma.VendorGetPayload<Record<string, never>>) {
    return {
      slug: vendor.slug,
      businessName: vendor.businessName,
      logoUrl: vendor.logoUrl,
      bannerUrl: vendor.bannerUrl,
      description: vendor.description,
      phone: vendor.phone,
      address: {
        line: vendor.addressLine,
        city: vendor.city,
        state: vendor.state,
        country: vendor.country,
      },
      policies: vendor.policies,
      ratingAvg: money(vendor.ratingAvg),
      ratingCount: vendor.ratingCount,
      fulfilmentMode: vendor.fulfilmentMode,
    };
  }

  private presentPrivate(vendor: Prisma.VendorGetPayload<Record<string, never>>) {
    return {
      ...this.presentPublic(vendor),
      id: vendor.id,
      status: vendor.status,
      commissionRate: money(vendor.commissionRate),
      payout: {
        bankName: vendor.payoutBankName,
        accountName: vendor.payoutAccountName,
        accountNumber: vendor.payoutAccountNumber,
      },
    };
  }

  private presentWithdrawal(row: { id: string; amount: Prisma.Decimal | number; status: string; bankName: string; accountName: string; accountNumber: string; note: string | null; reference: string | null; requestedAt: Date; decidedAt: Date | null }) {
    return {
      id: row.id,
      amount: money(row.amount),
      status: row.status,
      bankName: row.bankName,
      accountName: row.accountName,
      accountNumber: row.accountNumber,
      note: row.note,
      reference: row.reference,
      requestedAt: row.requestedAt,
      decidedAt: row.decidedAt,
    };
  }
}

function displayName(firstName: string, lastName: string) {
  const last = lastName.trim().charAt(0);
  return last ? `${firstName} ${last}.` : firstName;
}

function last4(value?: string | null) {
  if (!value) return null;
  return value.slice(-4);
}

export { pageQuery };
