import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { money } from '../../common/money';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PromotionsService } from './promotions.service';

const createSchema = z.object({
  code: z.string().min(3).max(40),
  type: z.enum(['percent', 'fixed']),
  amount: z.number().positive(),
  minSpend: z.number().min(0).optional(),
  usageLimit: z.number().int().positive().optional(),
  description: z.string().max(200).optional(),
});

@ApiTags('promotions')
@Controller('admin/promotions')
export class PromotionsController {
  constructor(private readonly promotions: PromotionsService) {}

  @Get()
  @Permissions('promotions.manage')
  async list() {
    const rows = await this.promotions.list();
    return rows.map((row) => ({ ...row, amount: money(row.amount), minSpend: money(row.minSpend) }));
  }

  @Post()
  @Permissions('promotions.manage')
  create(@Body({ schema: createSchema }) body: z.infer<typeof createSchema>) {
    return this.promotions.create(body);
  }

  @Patch(':id')
  @Permissions('promotions.manage')
  async update(
    @Param('id') id: string,
    @Body({ schema: z.object({
      active: z.boolean().optional(),
      amount: z.number().positive().optional(),
      minSpend: z.number().min(0).optional(),
      usageLimit: z.number().int().positive().nullable().optional(),
      description: z.string().max(200).nullable().optional(),
      startsAt: z.string().datetime().nullable().optional(),
      endsAt: z.string().datetime().nullable().optional(),
    }) })
    body: { active?: boolean; amount?: number; minSpend?: number; usageLimit?: number | null; description?: string | null; startsAt?: string | null; endsAt?: string | null },
  ) {
    const row = await this.promotions.update(id, {
      active: body.active,
      amount: body.amount,
      minSpend: body.minSpend,
      usageLimit: body.usageLimit,
      description: body.description,
      startsAt: body.startsAt === undefined ? undefined : body.startsAt ? new Date(body.startsAt) : null,
      endsAt: body.endsAt === undefined ? undefined : body.endsAt ? new Date(body.endsAt) : null,
    });
    return { ...row, amount: money(row.amount), minSpend: money(row.minSpend) };
  }
}
