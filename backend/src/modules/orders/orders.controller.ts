import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OrderStatus } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { OrdersService } from './orders.service';

const addressSchema = z.object({
  recipient: z.string().min(1),
  phone: z.string().min(8),
  state: z.string().min(2),
  lga: z.string().optional(),
  city: z.string().min(1),
  street: z.string().min(1),
  landmark: z.string().optional(),
});

const checkoutSchema = z
  .object({
    addressId: z.string().uuid().optional(),
    address: addressSchema.optional(),
    contactEmail: z.string().email().optional(),
    contactPhone: z.string().optional(),
    deliveryMethod: z.enum(['courier', 'pickup']).default('courier'),
    courier: z.enum(['gig', 'dhl']).optional(),
    paymentMethod: z.enum(['paystack', 'bank_transfer', 'account_credit']).default('paystack'),
    couponCode: z.string().optional(),
    confirmPriceChange: z.boolean().optional(),
    confirmUnverifiedFit: z.boolean().optional(),
    notes: z.string().max(500).optional(),
  })
  .refine((value) => value.addressId || value.address, { message: 'Delivery address is required' });

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.nativeEnum(OrderStatus).optional(),
});

const transitionSchema = z.object({
  status: z.enum([
    'pending_payment',
    'payment_failed',
    'paid',
    'awaiting_stock',
    'processing',
    'packed',
    'dispatched',
    'delivered',
    'completed',
    'cancelled',
    'return_requested',
    'returned',
  ]),
});

const returnSchema = z.object({
  reasonCode: z.string().min(2).max(40),
  notes: z.string().max(1000).optional(),
});

@ApiTags('orders')
@Controller()
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Public()
  @Post('checkout')
  checkout(
    @CurrentUser() user: AuthUser | undefined,
    @Headers('x-guest-token') guestToken: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body({ schema: checkoutSchema }) body: z.infer<typeof checkoutSchema>,
  ) {
    return this.orders.checkout({ ...body, courierCode: body.courier, userId: user?.sub, guestToken, idempotencyKey });
  }

  @Get('orders')
  list(@CurrentUser() user: AuthUser, @Query({ schema: pageQuery }) query: z.infer<typeof pageQuery>) {
    return this.orders.mine(user.sub, query.page, query.pageSize);
  }

  @Get('orders/:id')
  one(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.one(id, user.sub);
  }

  @Post('orders/:id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.cancelMine(id, user.sub);
  }

  @Post('b2b/quotes/:id/order')
  acceptQuote(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body({ schema: z.object({ address: addressSchema, paymentMethod: z.enum(['paystack', 'bank_transfer', 'account_credit']).default('account_credit'), courier: z.enum(['gig', 'dhl']).optional() }) })
    body: { address: z.infer<typeof addressSchema>; paymentMethod: 'paystack' | 'bank_transfer' | 'account_credit'; courier?: 'gig' | 'dhl' },
  ) {
    return this.orders.placeFromQuote(id, user.sub, { address: body.address, paymentMethod: body.paymentMethod, courierCode: body.courier });
  }

  @Post('orders/:id/returns')
  returns(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body({ schema: returnSchema }) body: z.infer<typeof returnSchema>) {
    return this.orders.requestReturn(id, user.sub, body.reasonCode, body.notes);
  }

  @Get('admin/returns')
  @Permissions('orders.manage')
  returnQueue() {
    return this.orders.listReturns();
  }

  @Get('admin/orders')
  @Permissions('orders.manage')
  admin(@Query({ schema: pageQuery }) query: z.infer<typeof pageQuery>) {
    return this.orders.adminList(query.page, query.pageSize, query.status);
  }

  @Post('admin/orders')
  @Permissions('orders.manage')
  desk(
    @CurrentUser() user: AuthUser,
    @Body({ schema: z.object({
      customerId: z.string().uuid().optional(),
      contactEmail: z.string().email().optional(),
      contactPhone: z.string().optional(),
      address: addressSchema,
      lines: z.array(z.object({ skuId: z.string().uuid(), qty: z.number().int().positive() })).min(1).max(50),
      paymentMethod: z.enum(['paystack', 'bank_transfer', 'counter']),
      notes: z.string().max(500).optional(),
    }) })
    body: { customerId?: string; contactEmail?: string; contactPhone?: string; address: z.infer<typeof addressSchema>; lines: { skuId: string; qty: number }[]; paymentMethod: 'paystack' | 'bank_transfer' | 'counter'; notes?: string },
  ) {
    return this.orders.deskOrder(user.sub, body);
  }

  @Get('admin/orders/:id')
  @Permissions('orders.manage')
  adminOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.one(id, user.sub, true);
  }

  @Post('admin/returns/:id/decision')
  @Permissions('orders.manage')
  decideReturn(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body({ schema: z.object({ decision: z.enum(['approved', 'rejected']), note: z.string().max(500).optional() }) }) body: { decision: 'approved' | 'rejected'; note?: string },
  ) {
    return this.orders.decideReturn(id, user.sub, body.decision, body.note);
  }

  @Post('admin/returns/:id/receive')
  @Permissions('orders.manage')
  receiveReturn(@Param('id') id: string) {
    return this.orders.receiveReturn(id);
  }

  @Post('admin/returns/:id/inspect')
  @Permissions('orders.manage')
  inspectReturn(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body({ schema: z.object({ restockQty: z.number().int().min(0), note: z.string().max(500).optional() }) }) body: { restockQty: number; note?: string },
  ) {
    return this.orders.inspectReturn(id, user.sub, body.restockQty, body.note);
  }

  @Post('admin/returns/:id/refund')
  @Permissions('orders.refund.approve')
  refundReturn(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.refundReturn(id, user.sub);
  }

  @Post('admin/orders/:id/transitions')
  @Permissions('orders.manage')
  transition(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body({ schema: transitionSchema }) body: z.infer<typeof transitionSchema>) {
    return this.orders.transition(id, body.status, user.sub);
  }
}
