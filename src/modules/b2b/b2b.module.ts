import { Body, Controller, Get, HttpStatus, Module, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiException } from '../../common/api.exception';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { referenceCode } from '../../domain/slug';
import { PrismaService } from '../../prisma/prisma.service';

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
    qty: z.number().int().positive(),
    unitPrice: z.number().nonnegative(),
  })).min(1),
});

@ApiTags('b2b')
@Controller()
export class B2bController {
  constructor(private readonly prisma: PrismaService) {}

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
    return this.prisma.businessUser.findMany({
      where: { customerId: customer.id },
      include: { business: true },
    });
  }

  @Patch('admin/b2b/accounts/:id')
  @Permissions('b2b.manage')
  review(
    @Param('id') id: string,
    @Body({ schema: z.object({ status: z.enum(['pending', 'approved', 'rejected']), creditLimit: z.number().min(0).optional(), paymentTermsDays: z.number().int().min(0).optional() }) })
    body: { status: 'pending' | 'approved' | 'rejected'; creditLimit?: number; paymentTermsDays?: number },
  ) {
    return this.prisma.businessAccount.update({ where: { id }, data: body });
  }

  @Post('b2b/quotes')
  async quote(@CurrentUser() user: AuthUser, @Body({ schema: quoteSchema }) body: z.infer<typeof quoteSchema>) {
    const customer = await this.prisma.customer.findUnique({ where: { userId: user.sub } });
    if (!customer) throw new ApiException(HttpStatus.FORBIDDEN, 'CUSTOMER_REQUIRED', 'A customer profile is required');
    const membership = await this.prisma.businessUser.findFirst({ where: { customerId: customer.id } });
    return this.prisma.quote.create({
      data: {
        quoteNo: referenceCode('QT'),
        customerId: customer.id,
        businessAccountId: membership?.businessAccountId,
        notes: body.notes,
        items: { create: body.items },
      },
      include: { items: true },
    });
  }
}

@Module({ controllers: [B2bController] })
export class B2bModule {}
