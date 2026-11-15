import { Body, Controller, Get, Headers, Param, Post, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ShippingService } from './shipping.service';

const quoteSchema = z.object({
  state: z.string().min(2),
  weightG: z.number().int().min(0).default(500),
  method: z.enum(['courier', 'pickup']).default('courier'),
  courier: z.enum(['gig', 'dhl']).optional(),
});

const eventSchema = z.object({
  trackingNo: z.string().min(4),
  status: z.enum(['in_transit', 'out_for_delivery', 'delivered', 'exception']),
  note: z.string().max(300).optional(),
});

@ApiTags('shipping')
@Controller('shipping')
export class ShippingController {
  constructor(
    private readonly shipping: ShippingService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('quote')
  quote(@Body({ schema: quoteSchema }) body: z.infer<typeof quoteSchema>) {
    return this.shipping.quote(body.state, body.weightG, body.method, body.courier);
  }

  @Public()
  @Get('track/:trackingNo')
  track(@Param('trackingNo') trackingNo: string) {
    return this.shipping.track(trackingNo);
  }

  @Public()
  @Post('webhooks/:courier')
  webhook(
    @Param('courier') courier: string,
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-courier-signature') signature: string | undefined,
    @Body({ schema: eventSchema }) body: z.infer<typeof eventSchema>,
  ) {
    const code = courier.toLowerCase();
    if (code !== 'gig' && code !== 'dhl') return { ignored: true };
    this.shipping.assertWebhook(
      this.config.get<string>('COURIER_WEBHOOK_SECRET') ?? '',
      req.rawBody,
      signature,
      this.config.get('NODE_ENV') === 'production',
    );
    return this.shipping.applyEvent(code, body.trackingNo, body.status, body.note);
  }
}

@ApiTags('shipping')
@Controller()
export class ShippingAdminController {
  constructor(private readonly shipping: ShippingService) {}

  @Get('admin/shipments')
  @Permissions('orders.manage')
  list() {
    return this.shipping.listAdmin();
  }

  @Post('admin/shipments/:id/book')
  @Permissions('orders.manage')
  book(@Param('id') id: string) {
    return this.shipping.retryBooking(id);
  }

  @Post('admin/shipments/events')
  @Permissions('orders.manage')
  record(@CurrentUser() _user: AuthUser, @Body({ schema: eventSchema.extend({ courier: z.enum(['gig', 'dhl']) }) }) body: z.infer<typeof eventSchema> & { courier: 'gig' | 'dhl' }) {
    return this.shipping.applyEvent(body.courier, body.trackingNo, body.status, body.note);
  }
}
