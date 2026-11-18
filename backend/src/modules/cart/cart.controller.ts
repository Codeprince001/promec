import { Body, Controller, Delete, Get, Headers, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CartService } from './cart.service';

const addSchema = z.object({
  skuId: z.string().uuid(),
  qty: z.number().int().min(1).max(999),
  vehicleVariantId: z.string().uuid().optional(),
});
const qtySchema = z.object({ qty: z.number().int().min(0).max(999) });
const mergeSchema = z.object({ guestToken: z.string().uuid() });

@ApiTags('cart')
@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Public()
  @Get()
  get(@CurrentUser() user: AuthUser | undefined, @Headers('x-guest-token') guestToken?: string) {
    return this.cart.get({ userId: user?.sub, guestToken });
  }

  @Public()
  @Post('items')
  add(
    @CurrentUser() user: AuthUser | undefined,
    @Headers('x-guest-token') guestToken: string | undefined,
    @Body({ schema: addSchema }) body: z.infer<typeof addSchema>,
  ) {
    return this.cart.add({ userId: user?.sub, guestToken, ...body });
  }

  @Public()
  @Patch('items/:id')
  update(
    @CurrentUser() user: AuthUser | undefined,
    @Headers('x-guest-token') guestToken: string | undefined,
    @Param('id') id: string,
    @Body({ schema: qtySchema }) body: z.infer<typeof qtySchema>,
  ) {
    return this.cart.updateQty({ userId: user?.sub, guestToken, itemId: id, qty: body.qty });
  }

  @Public()
  @Delete('items/:id')
  remove(
    @CurrentUser() user: AuthUser | undefined,
    @Headers('x-guest-token') guestToken: string | undefined,
    @Param('id') id: string,
  ) {
    return this.cart.remove({ userId: user?.sub, guestToken, itemId: id });
  }

  @Post('merge')
  merge(@CurrentUser() user: AuthUser, @Body({ schema: mergeSchema }) body: z.infer<typeof mergeSchema>) {
    return this.cart.merge(user.sub, body.guestToken);
  }
}
