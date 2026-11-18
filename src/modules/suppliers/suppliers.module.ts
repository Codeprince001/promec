import { Body, Controller, Get, HttpStatus, Module, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiException } from '../../common/api.exception';
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

  @Get(':id')
  @Permissions('procurement.manage')
  async one(@Param('id') id: string) {
    const row = await this.prisma.supplier.findUnique({ where: { id } });
    if (!row) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Supplier was not found');
    return row;
  }

  @Post()
  @Permissions('procurement.manage')
  create(@Body({ schema: supplierSchema }) body: z.infer<typeof supplierSchema>) {
    return this.prisma.supplier.create({ data: { ...body, status: 'approved' } });
  }

  @Patch(':id')
  @Permissions('procurement.manage')
  async update(@Param('id') id: string, @Body({ schema: supplierSchema.partial().extend({ status: z.enum(['pending', 'approved', 'suspended']).optional() }) }) body: Partial<z.infer<typeof supplierSchema>> & { status?: string }) {
    const current = await this.prisma.supplier.findUnique({ where: { id } });
    if (!current) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Supplier was not found');
    return this.prisma.supplier.update({ where: { id }, data: body });
  }
}

@Module({ controllers: [SuppliersController] })
export class SuppliersModule {}
