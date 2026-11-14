import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Public } from '../../common/decorators/public.decorator';
import { ShippingService } from './shipping.service';

const quoteSchema = z.object({
  state: z.string().min(2),
  weightG: z.number().int().min(0).default(500),
  method: z.enum(['courier', 'pickup']).default('courier'),
});

@ApiTags('shipping')
@Controller('shipping')
export class ShippingController {
  constructor(private readonly shipping: ShippingService) {}

  @Public()
  @Post('quote')
  quote(@Body({ schema: quoteSchema }) body: z.infer<typeof quoteSchema>) {
    return this.shipping.quote(body.state, body.weightG, body.method);
  }
}
