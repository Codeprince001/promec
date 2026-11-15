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
  async update(@Param('id') id: string, @Body({ schema: z.object({ active: z.boolean() }) }) body: { active: boolean }) {
    const row = await this.promotions.update(id, body.active);
    return { ...row, amount: money(row.amount), minSpend: money(row.minSpend) };
  }
}
