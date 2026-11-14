import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApiException } from '../../common/api.exception';
import { moneyNumber } from '../../common/money';
import { PrismaService } from '../../prisma/prisma.service';

export type Tx = Prisma.TransactionClient;

@Injectable()
export class PromotionsService {
  constructor(private readonly prisma: PrismaService) {}

  async preview(code: string | undefined, subtotal: number) {
    if (!code) return { code: null as string | null, discount: 0 };
    const promotion = await this.findActive(code);
    if (subtotal < moneyNumber(promotion.minSpend)) {
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'COUPON_MINIMUM', 'This code needs a higher subtotal');
    }
    const discount = promotion.type === 'percent'
      ? Math.min(subtotal, (subtotal * moneyNumber(promotion.amount)) / 100)
      : Math.min(subtotal, moneyNumber(promotion.amount));
    return { code: promotion.code, discount: Math.round(discount * 100) / 100 };
  }

  async consume(tx: Tx, code: string) {
    const promotion = await tx.promotion.findUnique({ where: { code: code.toUpperCase() } });
    if (!promotion || !promotion.active) {
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'COUPON_INVALID', 'Coupon code is not valid');
    }
    if (promotion.usageLimit != null && promotion.usedCount >= promotion.usageLimit) {
      throw new ApiException(HttpStatus.CONFLICT, 'COUPON_EXHAUSTED', 'This coupon has been fully used');
    }
    await tx.promotion.update({
      where: { id: promotion.id },
      data: { usedCount: { increment: 1 } },
    });
  }

  list() {
    return this.prisma.promotion.findMany({ orderBy: { createdAt: 'desc' } });
  }

  create(input: { code: string; type: 'percent' | 'fixed'; amount: number; minSpend?: number; usageLimit?: number; description?: string }) {
    return this.prisma.promotion.create({
      data: {
        code: input.code.toUpperCase(),
        type: input.type,
        amount: input.amount,
        minSpend: input.minSpend ?? 0,
        usageLimit: input.usageLimit,
        description: input.description,
      },
    });
  }

  private async findActive(code: string) {
    const now = new Date();
    const promotion = await this.prisma.promotion.findUnique({ where: { code: code.toUpperCase() } });
    if (!promotion || !promotion.active) {
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'COUPON_INVALID', 'Coupon code is not valid');
    }
    if (promotion.startsAt && promotion.startsAt > now) {
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'COUPON_INVALID', 'Coupon code is not active yet');
    }
    if (promotion.endsAt && promotion.endsAt < now) {
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'COUPON_INVALID', 'Coupon code has expired');
    }
    if (promotion.usageLimit != null && promotion.usedCount >= promotion.usageLimit) {
      throw new ApiException(HttpStatus.CONFLICT, 'COUPON_EXHAUSTED', 'This coupon has been fully used');
    }
    return promotion;
  }
}
