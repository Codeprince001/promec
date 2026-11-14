import { Controller, Get, Module, Post, Body } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { money } from '../../common/money';
import { PrismaService } from '../../prisma/prisma.service';
import { SearchModule } from '../search/search.module';
import { SearchService } from '../search/search.service';

@ApiTags('analytics')
@Controller('admin/analytics')
export class AnalyticsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('overview')
  @Permissions('analytics.view')
  async overview() {
    const [orders, paid, tickets, lowStock] = await this.prisma.$transaction([
      this.prisma.order.count(),
      this.prisma.order.aggregate({ where: { paymentStatus: 'paid' }, _sum: { grandTotal: true }, _count: true }),
      this.prisma.supportTicket.count({ where: { status: { in: ['open', 'pending'] } } }),
      this.prisma.inventory.count(),
    ]);
    const stock = await this.prisma.inventory.findMany({ select: { onHandQty: true, reservedQty: true, reorderPoint: true } });
    return {
      orders,
      paidOrders: paid._count,
      gmv: money(paid._sum.grandTotal),
      currency: 'NGN',
      openTickets: tickets,
      lowStockSkus: stock.filter((row) => row.onHandQty - row.reservedQty <= row.reorderPoint).length,
      trackedSkus: lowStock,
    };
  }
}

@ApiTags('ai')
@Controller('ai')
export class AiController {
  constructor(
    private readonly config: ConfigService,
    private readonly search: SearchService,
  ) {}

  @Public()
  @Post('assist')
  async assist(@Body({ schema: z.object({ message: z.string().min(2).max(500), vehicleVariantId: z.string().uuid().optional() }) }) body: { message: string; vehicleVariantId?: string }) {
    const enabled = this.config.get('FEATURE_NL_SEARCH') === 'true' || this.config.get('AI_PROVIDER') !== 'none';
    if (!enabled) {
      return {
        enabled: false,
        message: 'The parts assistant is switched off. Search by vehicle or part number.',
        products: [],
      };
    }
    const results = await this.search.search({
      q: body.message,
      vehicleVariantId: body.vehicleVariantId,
      page: 1,
      pageSize: 8,
    });
    return {
      enabled: true,
      message: 'These catalogue matches are grounded in PROMEC data. Fitment status comes only from stored compatibility records.',
      products: results.data,
    };
  }
}

@Module({
  controllers: [AnalyticsController],
})
export class AnalyticsModule {}

@Module({
  imports: [SearchModule],
  controllers: [AiController],
})
export class AiModule {}
