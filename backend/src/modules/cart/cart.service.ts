import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ApiException } from '../../common/api.exception';
import { money, moneyNumber } from '../../common/money';
import { PrismaService } from '../../prisma/prisma.service';
import { CompatibilityService } from '../compatibility/compatibility.service';

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly compatibility: CompatibilityService,
  ) {}

  async get(input: { userId?: string; guestToken?: string }) {
    const cart = await this.load(input, true);
    return this.present(cart);
  }

  async add(input: { userId?: string; guestToken?: string; skuId: string; qty: number; vehicleVariantId?: string }) {
    const cart = await this.load(input, true);
    const sku = await this.prisma.productSku.findUnique({ where: { id: input.skuId }, include: { product: true, inventory: true } });
    if (!sku || sku.product.status !== 'published') {
      throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Product was not found');
    }
    let available = sku.inventory.reduce((sum, row) => sum + row.onHandQty - row.reservedQty, 0);
    if (sku.product.vendorId) {
      const vendor = await this.prisma.vendor.findUnique({ where: { id: sku.product.vendorId } });
      if (vendor?.status === 'approved' && vendor.fulfilmentMode === 'vendor') {
        const stock = await this.prisma.vendorStock.findUnique({ where: { vendorId_skuId: { vendorId: vendor.id, skuId: sku.id } } });
        available = stock ? stock.onHandQty - stock.reservedQty : 0;
      }
    }
    if (available < input.qty) throw new ApiException(HttpStatus.CONFLICT, 'OUT_OF_STOCK', 'Not enough stock');
    let fitment: string | null = null;
    if (input.vehicleVariantId) {
      const decision = await this.compatibility.check(sku.productId, input.vehicleVariantId);
      if (decision.status === 'incompatible') {
        throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'INCOMPATIBLE', decision.notes);
      }
      fitment = decision.status;
    }
    const existing = cart.items.find((item) => item.skuId === sku.id && item.vehicleVariantId === (input.vehicleVariantId ?? null));
    if (existing) {
      await this.prisma.cartItem.update({
        where: { id: existing.id },
        data: { qty: existing.qty + input.qty, unitPriceSnapshot: sku.sellingPrice, fitmentStatusSnapshot: fitment as never },
      });
    } else {
      await this.prisma.cartItem.create({
        data: {
          cartId: cart.id,
          skuId: sku.id,
          qty: input.qty,
          vehicleVariantId: input.vehicleVariantId,
          fitmentStatusSnapshot: fitment as never,
          unitPriceSnapshot: sku.sellingPrice,
        },
      });
    }
    return this.present(await this.load(input, false));
  }

  async updateQty(input: { userId?: string; guestToken?: string; itemId: string; qty: number }) {
    const cart = await this.load(input, false);
    const item = cart.items.find((row) => row.id === input.itemId);
    if (!item) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Cart line was not found');
    if (input.qty <= 0) {
      await this.prisma.cartItem.delete({ where: { id: item.id } });
    } else {
      await this.prisma.cartItem.update({ where: { id: item.id }, data: { qty: input.qty } });
    }
    return this.present(await this.load(input, false));
  }

  async remove(input: { userId?: string; guestToken?: string; itemId: string }) {
    return this.updateQty({ ...input, qty: 0 });
  }

  async merge(userId: string, guestToken: string) {
    const customer = await this.prisma.customer.findUnique({ where: { userId } });
    if (!customer) throw new ApiException(HttpStatus.FORBIDDEN, 'CUSTOMER_REQUIRED', 'A customer profile is required');
    const guest = await this.prisma.cart.findUnique({ where: { guestToken }, include: { items: true } });
    if (!guest) return this.get({ userId });
    const account = await this.load({ userId }, true);
    for (const item of guest.items) {
      const existing = account.items.find((row) => row.skuId === item.skuId && row.vehicleVariantId === item.vehicleVariantId);
      if (existing) {
        await this.prisma.cartItem.update({ where: { id: existing.id }, data: { qty: existing.qty + item.qty } });
      } else {
        await this.prisma.cartItem.update({ where: { id: item.id }, data: { cartId: account.id } });
      }
    }
    await this.prisma.cart.delete({ where: { id: guest.id } }).catch(() => undefined);
    return this.get({ userId });
  }

  async openCart(input: { userId?: string; guestToken?: string }) {
    return this.load(input, false);
  }

  private async load(input: { userId?: string; guestToken?: string }, create: boolean) {
    if (input.userId) {
      const customer = await this.prisma.customer.findUnique({ where: { userId: input.userId } });
      if (!customer) throw new ApiException(HttpStatus.FORBIDDEN, 'CUSTOMER_REQUIRED', 'A customer profile is required');
      const existing = await this.prisma.cart.findFirst({
        where: { customerId: customer.id, status: 'open' },
        include: itemInclude,
      });
      if (existing) return existing;
      if (!create) throw new ApiException(HttpStatus.NOT_FOUND, 'CART_EMPTY', 'Cart is empty');
      return this.prisma.cart.create({ data: { customerId: customer.id }, include: itemInclude });
    }
    if (input.guestToken) {
      const existing = await this.prisma.cart.findUnique({ where: { guestToken: input.guestToken }, include: itemInclude });
      if (existing) return existing;
    }
    if (!create) throw new ApiException(HttpStatus.NOT_FOUND, 'CART_EMPTY', 'Cart is empty');
    const guestToken = input.guestToken || randomUUID();
    return this.prisma.cart.create({ data: { guestToken }, include: itemInclude });
  }

  private present(cart: Awaited<ReturnType<CartService['load']>>) {
    const lines = cart.items.map((item) => {
      const price = moneyNumber(item.sku.sellingPrice);
      return {
        id: item.id,
        skuId: item.skuId,
        sku: item.sku.sku,
        name: item.sku.product.name,
        slug: item.sku.product.slug,
        qty: item.qty,
        vehicleVariantId: item.vehicleVariantId,
        fitmentStatus: item.fitmentStatusSnapshot,
        unitPrice: money(item.sku.sellingPrice),
        lineTotal: money(price * item.qty),
        currency: item.sku.currencyCode,
      };
    });
    const subtotal = lines.reduce((sum, line) => sum + Number(line.lineTotal), 0);
    return {
      data: {
        id: cart.id,
        guestToken: cart.guestToken,
        currency: 'NGN',
        items: lines,
        subtotal: money(subtotal),
      },
      meta: { guestToken: cart.guestToken },
    };
  }
}

const itemInclude = {
  items: { include: { sku: { include: { product: true } } } },
} as const;
