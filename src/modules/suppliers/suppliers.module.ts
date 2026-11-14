import { Body, Controller, Get, Module, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PrismaService } from '../../prisma/prisma.service';

const supplierSchema = z.object({
  legalName: z.string().min(2),
  country: z.string().min(2).max(80),
  tier: z.number().int().min(1).max(3).default(2),
  currency: z.string().length(3).default('USD'),
  email: z.string().email().optional(),
  paymentTerms: z.string().optional(),
});

@ApiTags('suppliers')
@Controller('admin/suppliers')
export class SuppliersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Permissions('procurement.manage')
  list() {
    return this.prisma.supplier.findMany({ orderBy: { legalName: 'asc' } });
  }

  @Post()
  @Permissions('procurement.manage')
  create(@Body({ schema: supplierSchema }) body: z.infer<typeof supplierSchema>) {
    return this.prisma.supplier.create({ data: { ...body, status: 'approved' } });
  }
}

@Module({ controllers: [SuppliersController] })
export class SuppliersModule {}
