import { Body, Controller, Get, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiException } from '../../common/api.exception';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { money } from '../../common/money';
import { referenceCode } from '../../domain/slug';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreditService } from './credit.service';

const accountSchema = z.object({
  legalName: z.string().min(2),
  cacNumber: z.string().min(3).optional(),
  tin: z.string().optional(),
  industry: z.string().optional(),
});

const quoteSchema = z.object({
  notes: z.string().optional(),
  items: z.array(z.object({
    description: z.string().min(2),
    skuId: z.string().uuid().optional(),
    qty: z.number().int().positive(),
    unitPrice: z.number().nonnegative(),
  })).min(1),
});

const reviewSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']),
  creditLimit: z.number().min(0).optional(),
  paymentTermsDays: z.number().int().min(0).max(180).optional(),
  discountRate: z.number().min(0).max(0.5).optional(),
});

@ApiTags('b2b')
@Controller()
export class B2bController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credit: CreditService,
    private readonly audit: AuditService,
  ) {}

  @Post('b2b/accounts')
  async open(@CurrentUser() user: AuthUser, @Body({ schema: accountSchema }) body: z.infer<typeof accountSchema>) {
    const customer = await this.prisma.customer.findUnique({ where: { userId: user.sub } });
    if (!customer) throw new ApiException(HttpStatus.FORBIDDEN, 'CUSTOMER_REQUIRED', 'A customer profile is required');
    const account = await this.prisma.businessAccount.create({ data: body });
    await this.prisma.businessUser.create({
      data: { businessAccountId: account.id, customerId: customer.id, businessRole: 'owner' },
    });
    return account;
  }

  @Get('b2b/accounts/me')
  async mine(@CurrentUser() user: AuthUser) {
    const customer = await this.prisma.customer.findUnique({ where: { userId: user.sub } });
    if (!customer) return [];
    const memberships = await this.prisma.businessUser.findMany({
      where: { customerId: customer.id },
      include: { business: true },
    });
    return Promise.all(memberships.map(async (membership) => ({
      role: membership.businessRole,
      spendingLimit: membership.spendingLimit == null ? null : money(membership.spendingLimit),
      account: await this.credit.position(membership.businessAccountId),
    })));
  }

  @Get('b2b/credit')
  creditPosition(@CurrentUser() user: AuthUser) {
    return this.credit.termsFor(user.sub);
  }

  @Get('admin/b2b/accounts')
  @Permissions('b2b.manage')
  async listAccounts() {
    const rows = await this.prisma.businessAccount.findMany({ orderBy: { createdAt: 'desc' } });
    return Promise.all(rows.map((row) => this.credit.position(row.id)));
  }

  @Get('admin/b2b/accounts/:id')
  @Permissions('b2b.manage')
  statement(@Param('id') id: string) {
    return this.credit.statement(id);
  }

  @Patch('admin/b2b/accounts/:id')
  @Permissions('b2b.manage')
  async review(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body({ schema: reviewSchema }) body: z.infer<typeof reviewSchema>) {
    const updated = await this.prisma.businessAccount.update({ where: { id }, data: body });
    await this.audit.log({
      actorId: user.sub,
      action: 'b2b.review',
      entityType: 'business_account',
      entityId: id,
      after: body,
    });
    return this.credit.position(updated.id);
  }

  @Post('admin/b2b/accounts/:id/payments')
  @Permissions('b2b.manage')
  receive(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body({ schema: z.object({ amount: z.number().positive(), reference: z.string().min(2).max(80) }) })
    body: { amount: number; reference: string },
  ) {
    return this.credit.recordPayment(id, body.amount, body.reference, user.sub);
  }

  @Post('b2b/quotes')
  async quote(@CurrentUser() user: AuthUser, @Body({ schema: quoteSchema }) body: z.infer<typeof quoteSchema>) {
    const customer = await this.prisma.customer.findUnique({ where: { userId: user.sub } });
    if (!customer) throw new ApiException(HttpStatus.FORBIDDEN, 'CUSTOMER_REQUIRED', 'A customer profile is required');
    const membership = await this.prisma.businessUser.findFirst({ where: { customerId: customer.id, business: { status: 'approved' } } });
    const created = await this.prisma.quote.create({
      data: {
        quoteNo: referenceCode('QT'),
        customerId: customer.id,
        businessAccountId: membership?.businessAccountId,
        notes: body.notes,
        items: { create: body.items },
      },
      include: { items: true },
    });
    return presentQuote(created);
  }

  @Post('b2b/quotes/:id/submit')
  async submit(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const quote = await this.ownedQuote(user.sub, id);
    if (quote.status !== 'draft') throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'Only a draft quote can be submitted');
    const updated = await this.prisma.quote.update({ where: { id }, data: { status: 'submitted' }, include: { items: true } });
    return presentQuote(updated);
  }

  @Get('admin/b2b/quotes')
  @Permissions('b2b.manage')
  async listQuotes() {
    const rows = await this.prisma.quote.findMany({ include: { items: true }, orderBy: { createdAt: 'desc' } });
    return rows.map(presentQuote);
  }

  @Post('admin/b2b/quotes/:id/decision')
  @Permissions('b2b.manage')
  async decide(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body({ schema: z.object({ status: z.enum(['approved', 'rejected']), validDays: z.number().int().min(1).max(90).default(14) }) })
    body: { status: 'approved' | 'rejected'; validDays: number },
  ) {
    const quote = await this.prisma.quote.findUnique({ where: { id } });
    if (!quote || quote.status !== 'submitted') {
      throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'Only a submitted quote can be decided');
    }
    const updated = await this.prisma.quote.update({
      where: { id },
      data: {
        status: body.status,
        validUntil: body.status === 'approved' ? new Date(Date.now() + body.validDays * 24 * 60 * 60 * 1000) : null,
      },
      include: { items: true },
    });
    await this.audit.log({
      actorId: user.sub,
      action: 'quote.decide',
      entityType: 'quote',
      entityId: id,
      after: { status: body.status },
    });
    return presentQuote(updated);
  }

  @Post('admin/b2b/accounts/:id/price-lists')
  @Permissions('b2b.manage')
  async createPriceList(
    @Param('id') id: string,
    @Body({ schema: z.object({
      name: z.string().min(2),
      validUntil: z.string().datetime().optional(),
      items: z.array(z.object({ skuId: z.string().uuid(), unitPrice: z.number().positive() })).min(1),
    }) }) body: { name: string; validUntil?: string; items: { skuId: string; unitPrice: number }[] },
  ) {
    const account = await this.prisma.businessAccount.findUnique({ where: { id } });
    if (!account || account.status !== 'approved') throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'Price lists belong to an approved account');
    const skus = await this.prisma.productSku.count({ where: { id: { in: body.items.map((item) => item.skuId) } } });
    if (skus !== new Set(body.items.map((item) => item.skuId)).size) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'A price-list SKU was not found');
    return this.prisma.priceList.create({
      data: {
        businessAccountId: id,
        name: body.name,
        validUntil: body.validUntil ? new Date(body.validUntil) : undefined,
        items: { create: body.items },
      },
      include: { items: true },
    });
  }

  @Get('admin/b2b/accounts/:id/price-lists')
  @Permissions('b2b.manage')
  priceLists(@Param('id') id: string) {
    return this.prisma.priceList.findMany({ where: { businessAccountId: id }, include: { items: true }, orderBy: { createdAt: 'desc' } });
  }

  private async ownedQuote(userId: string, id: string) {
    const customer = await this.prisma.customer.findUnique({ where: { userId } });
    const quote = await this.prisma.quote.findUnique({ where: { id }, include: { items: true } });
    if (!quote || !customer || quote.customerId !== customer.id) {
      throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Quote was not found');
    }
    return quote;
  }
}

function presentQuote(quote: {
  id: string;
  quoteNo: string;
  status: string;
  currencyCode: string;
  validUntil: Date | null;
  notes: string | null;
  items: { skuId?: string | null; description: string; qty: number; unitPrice: { toString(): string } }[];
}) {
  const total = quote.items.reduce((sum, item) => sum + item.qty * Number(item.unitPrice), 0);
  return {
    id: quote.id,
    quoteNo: quote.quoteNo,
    status: quote.status,
    currency: quote.currencyCode,
    validUntil: quote.validUntil?.toISOString() ?? null,
    notes: quote.notes,
    total: money(total),
    items: quote.items.map((item) => ({
      skuId: item.skuId ?? null,
      description: item.description,
      qty: item.qty,
      unitPrice: money(Number(item.unitPrice)),
    })),
  };
}
