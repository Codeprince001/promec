import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { PaymentsService } from './payments.service';

const webhookSchema = z.object({
  event: z.string(),
  data: z.object({
    reference: z.string(),
    amount: z.number(),
  }),
});

const refundSchema = z.object({
  amount: z.number().positive(),
  reason: z.string().min(3).max(300),
});

const proofSchema = z.object({
  amount: z.number().positive(),
  bankReference: z.string().min(4).max(80),
  evidenceUrl: z.string().url(),
});

@ApiTags('payments')
@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Public()
  @HttpCode(200)
  @Post('payments/webhooks/paystack')
  paystack(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-paystack-signature') signature: string | undefined,
    @Body({ schema: webhookSchema }) body: z.infer<typeof webhookSchema>,
  ) {
    return this.payments.handleWebhook(req.rawBody, signature, body);
  }

  @Public()
  @Post('payments/:reference/initialize')
  initialize(@Param('reference') reference: string) {
    return this.payments.initialize(reference);
  }

  @Public()
  @Post('payments/:reference/simulate')
  simulate(@Param('reference') reference: string) {
    return this.payments.simulate(reference);
  }

  @Public()
  @Post('payments/:reference/proof')
  proof(@Param('reference') reference: string, @Body({ schema: proofSchema }) body: z.infer<typeof proofSchema>) {
    return this.payments.submitProof(reference, body);
  }

  @Get('admin/payments/proofs')
  @Permissions('payments.manage')
  proofs(@Query('status') status?: string) {
    return this.payments.listProofs(status || 'pending');
  }

  @Post('admin/payments/proofs/:id/match')
  @Permissions('payments.manage')
  match(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.payments.matchProof(id, user.sub);
  }

  @Post('admin/payments/proofs/:id/reject')
  @Permissions('payments.manage')
  reject(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body({ schema: z.object({ note: z.string().min(3).max(300) }) }) body: { note: string }) {
    return this.payments.rejectProof(id, user.sub, body.note);
  }

  @Get('admin/payments')
  @Permissions('payments.manage')
  list(@Query({ schema: z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20), status: z.string().optional() }) }) query: { page: number; pageSize: number; status?: string }) {
    return this.payments.list(query.page, query.pageSize, query.status);
  }

  @Get('admin/payments/reconciliation')
  @Permissions('payments.manage')
  reconcile(@Query({ schema: z.object({ days: z.coerce.number().int().min(1).max(90).default(7) }) }) query: { days: number }) {
    return this.payments.reconcile(query.days);
  }

  @Post('admin/payments/:reference/confirm')
  @Permissions('payments.manage')
  confirm(@Param('reference') reference: string) {
    return this.payments.confirm(reference);
  }

  @Post('admin/payments/:id/refunds')
  @Permissions('orders.refund.approve')
  refund(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body({ schema: refundSchema }) body: z.infer<typeof refundSchema>) {
    return this.payments.refund(user.sub, id, body.amount, body.reason);
  }
}
