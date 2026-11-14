import { Injectable } from '@nestjs/common';
import { money, moneyNumber } from '../../common/money';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ShippingService {
  constructor(private readonly prisma: PrismaService) {}

  async quote(state: string, weightG: number, method: 'courier' | 'pickup') {
    if (method === 'pickup') {
      return { method, amount: '0.00', currency: 'NGN', zone: 'Warehouse pickup' };
    }
    const zones = await this.prisma.deliveryZone.findMany({ where: { isActive: true } });
    const match = zones.find((zone) => zone.states.some((item) => item.toLowerCase() === state.toLowerCase()))
      ?? zones.find((zone) => zone.name === 'Nationwide');
    const kg = Math.max(weightG / 1000, 0.5);
    const amount = match ? moneyNumber(match.baseFee) + moneyNumber(match.perKgFee) * kg : 3500;
    return {
      method,
      amount: money(amount),
      currency: 'NGN',
      zone: match?.name ?? 'Standard',
    };
  }
}
