import { Body, Controller, Headers, HttpCode, Param, Post, Req } from '@nestjs/common';
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
