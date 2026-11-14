import { Body, Controller, Get, Module, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { landedCost } from '../../domain/landed-cost';
import { referenceCode } from '../../domain/slug';
import { PrismaService } from '../../prisma/prisma.service';

const poSchema = z.object({
  supplierId: z.string().uuid(),
  currency: z.string().length(3),
  incoterm: z.string().optional(),
  items: z.array(z.object({
    description: z.string().min(2),
    qty: z.number().int().positive(),
    unitPrice: z.number().positive(),
    weightKg: z.number().min(0).default(0),
  })).min(1),
});

const costSchema = z.object({
  unitPriceFx: z.number().nonnegative(),
  fxRate: z.number().positive(),
  freightAlloc: z.number().nonnegative().default(0),
  insuranceAlloc: z.number().nonnegative().default(0),
  dutyAlloc: z.number().nonnegative().default(0),
  clearingAlloc: z.number().nonnegative().default(0),
  bankAlloc: z.number().nonnegative().default(0),
  handlingPerUnit: z.number().nonnegative().default(0),
  fxBufferPct: z.number().min(0).max(1).default(0.02),
  targetMargin: z.number().min(0).max(0.9).default(0.25),
  floorPrice: z.number().min(0).default(0),
});

const importSchema = z.object({
  poId: z.string().uuid().optional(),
  mode: z.enum(['air', 'sea', 'courier']),
  blAwbNo: z.string().optional(),
  eta: z.string().datetime().optional(),
});

@ApiTags('procurement')
@Controller('admin')
export class ProcurementController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('purchase-orders')
  @Permissions('procurement.manage')
  listOrders() {
    return this.prisma.purchaseOrder.findMany({ include: { items: true, supplier: true }, orderBy: { createdAt: 'desc' } });
  }

  @Post('purchase-orders')
  @Permissions('procurement.manage')
  async createOrder(@Body({ schema: poSchema }) body: z.infer<typeof poSchema>) {
    const total = body.items.reduce((sum, item) => sum + item.qty * item.unitPrice, 0);
    return this.prisma.purchaseOrder.create({
      data: {
        poNo: referenceCode('PO'),
        supplierId: body.supplierId,
        currency: body.currency,
        incoterm: body.incoterm,
        total,
        items: { create: body.items },
      },
      include: { items: true },
    });
  }

  @Post('purchase-orders/landed-cost')
  @Permissions('procurement.manage')
  price(@Body({ schema: costSchema }) body: z.infer<typeof costSchema>) {
    const result = landedCost(body);
    return {
      landedUnitCost: result.landedUnitCost.toFixed(2),
      sellingPrice: result.sellingPrice.toFixed(2),
      currency: 'NGN',
    };
  }

  @Get('imports')
  @Permissions('procurement.manage')
  listImports() {
    return this.prisma.importRecord.findMany({ orderBy: { createdAt: 'desc' } });
  }

  @Post('imports')
  @Permissions('procurement.manage')
  createImport(@Body({ schema: importSchema }) body: z.infer<typeof importSchema>) {
    return this.prisma.importRecord.create({
      data: { poId: body.poId, mode: body.mode, blAwbNo: body.blAwbNo, eta: body.eta ? new Date(body.eta) : undefined },
    });
  }

  @Patch('imports/:id')
  @Permissions('procurement.manage')
  updateImport(@Param('id') id: string, @Body({ schema: z.object({ status: z.string().min(2) }) }) body: { status: string }) {
    return this.prisma.importRecord.update({ where: { id }, data: { status: body.status } });
  }
}

@Module({ controllers: [ProcurementController] })
export class ProcurementModule {}
