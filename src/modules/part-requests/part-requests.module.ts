import { Body, Controller, Get, HttpStatus, Module, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiException } from '../../common/api.exception';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';

const requestSchema = z.object({
  description: z.string().min(5).max(2000),
  partNumber: z.string().max(80).optional(),
  vehicleVariantId: z.string().uuid().optional(),
  vin: z.string().max(17).optional(),
  contactEmail: z.string().email().optional(),
});

@ApiTags('part-requests')
@Controller('part-requests')
export class PartRequestsController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Post()
  async create(@CurrentUser() user: AuthUser | undefined, @Body({ schema: requestSchema }) body: z.infer<typeof requestSchema>) {
    const customer = user ? await this.prisma.customer.findUnique({ where: { userId: user.sub } }) : null;
    if (!customer && !body.contactEmail) {
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_ERROR', 'Email is required so we can send the quote');
    }
    return this.prisma.partRequest.create({
      data: { ...body, customerId: customer?.id },
    });
  }

  @Get()
  async mine(@CurrentUser() user: AuthUser) {
    const customer = await this.prisma.customer.findUnique({ where: { userId: user.sub } });
    if (!customer) return [];
    return this.prisma.partRequest.findMany({ where: { customerId: customer.id }, orderBy: { createdAt: 'desc' } });
  }

  @Patch(':id')
  @Permissions('procurement.manage')
  async update(@Param('id') id: string, @Body({ schema: z.object({ status: z.string().min(2) }) }) body: { status: string }) {
    const row = await this.prisma.partRequest.findUnique({ where: { id } });
    if (!row) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Part request was not found');
    return this.prisma.partRequest.update({ where: { id }, data: { status: body.status } });
  }
}

@Module({ controllers: [PartRequestsController] })
export class PartRequestsModule {}
