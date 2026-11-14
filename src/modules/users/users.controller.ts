import { Body, Controller, Delete, Get, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiException } from '../../common/api.exception';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';

const addressSchema = z.object({
  label: z.string().max(40).optional(),
  recipient: z.string().min(1),
  phone: z.string().min(8),
  state: z.string().min(2),
  lga: z.string().optional(),
  city: z.string().min(1),
  street: z.string().min(1),
  landmark: z.string().optional(),
  isDefaultShipping: z.boolean().optional(),
  isDefaultBilling: z.boolean().optional(),
});

async function customerOf(prisma: PrismaService, userId: string) {
  const customer = await prisma.customer.findUnique({ where: { userId } });
  if (!customer) throw new ApiException(HttpStatus.FORBIDDEN, 'CUSTOMER_REQUIRED', 'A customer profile is required');
  return customer;
}

@ApiTags('account')
@Controller()
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('me/addresses')
  async addresses(@CurrentUser() user: AuthUser) {
    const customer = await customerOf(this.prisma, user.sub);
    return this.prisma.customerAddress.findMany({ where: { customerId: customer.id }, orderBy: { createdAt: 'desc' } });
  }

  @Post('me/addresses')
  async addAddress(@CurrentUser() user: AuthUser, @Body({ schema: addressSchema }) body: z.infer<typeof addressSchema>) {
    const customer = await customerOf(this.prisma, user.sub);
    if (body.isDefaultShipping) {
      await this.prisma.customerAddress.updateMany({ where: { customerId: customer.id }, data: { isDefaultShipping: false } });
    }
    return this.prisma.customerAddress.create({ data: { ...body, customerId: customer.id } });
  }

  @Patch('me/addresses/:id')
  async updateAddress(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body({ schema: addressSchema.partial() }) body: Partial<z.infer<typeof addressSchema>>,
  ) {
    const customer = await customerOf(this.prisma, user.sub);
    const address = await this.prisma.customerAddress.findFirst({ where: { id, customerId: customer.id } });
    if (!address) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Address was not found');
    return this.prisma.customerAddress.update({ where: { id }, data: body });
  }

  @Delete('me/addresses/:id')
  async deleteAddress(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const customer = await customerOf(this.prisma, user.sub);
    const address = await this.prisma.customerAddress.findFirst({ where: { id, customerId: customer.id } });
    if (!address) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Address was not found');
    await this.prisma.customerAddress.delete({ where: { id } });
    return { deleted: true };
  }

  @Get('wishlist')
  async wishlist(@CurrentUser() user: AuthUser) {
    const customer = await customerOf(this.prisma, user.sub);
    return this.prisma.wishlistItem.findMany({
      where: { customerId: customer.id },
      include: { sku: { include: { product: true } } },
    });
  }

  @Post('wishlist')
  async save(@CurrentUser() user: AuthUser, @Body({ schema: z.object({ skuId: z.string().uuid() }) }) body: { skuId: string }) {
    const customer = await customerOf(this.prisma, user.sub);
    return this.prisma.wishlistItem.upsert({
      where: { customerId_skuId: { customerId: customer.id, skuId: body.skuId } },
      update: {},
      create: { customerId: customer.id, skuId: body.skuId },
    });
  }

  @Delete('wishlist/:skuId')
  async unsave(@CurrentUser() user: AuthUser, @Param('skuId') skuId: string) {
    const customer = await customerOf(this.prisma, user.sub);
    await this.prisma.wishlistItem.deleteMany({ where: { customerId: customer.id, skuId } });
    return { deleted: true };
  }
}
