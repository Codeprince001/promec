import { Body, Controller, Get, HttpStatus, Module, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiException } from '../../common/api.exception';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { slaDueAt } from '../../domain/operations';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Public()
  @Post()
  async create(@CurrentUser() user: AuthUser | undefined, @Body({ schema: requestSchema }) body: z.infer<typeof requestSchema>) {
    const customer = user ? await this.prisma.customer.findUnique({ where: { userId: user.sub } }) : null;
    if (!customer && !body.contactEmail) {
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_ERROR', 'Email is required so we can send the quote');
    }
    return this.prisma.partRequest.create({
      data: { ...body, customerId: customer?.id, dueAt: slaDueAt('normal') },
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

  @Post(':id/assign')
  @Permissions('procurement.manage')
  async assign(@Param('id') id: string, @Body({ schema: z.object({ assigneeId: z.string().uuid() }) }) body: { assigneeId: string }) {
    const row = await this.prisma.partRequest.findUnique({ where: { id } });
    if (!row) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Part request was not found');
    return this.prisma.partRequest.update({ where: { id }, data: { assigneeId: body.assigneeId, status: 'assigned' } });
  }

  @Post(':id/quote')
  @Permissions('procurement.manage')
  async quote(
    @Param('id') id: string,
    @Body({ schema: z.object({ quotedPrice: z.number().positive(), quoteNote: z.string().min(2).max(1000) }) }) body: { quotedPrice: number; quoteNote: string },
  ) {
    const row = await this.prisma.partRequest.findUnique({ where: { id }, include: { customer: true } });
    if (!row) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Part request was not found');
    const updated = await this.prisma.partRequest.update({
      where: { id },
      data: { quotedPrice: body.quotedPrice, quoteNote: body.quoteNote, status: 'quoted' },
    });
    await this.notifications.enqueue({
      userId: row.customer?.userId,
      to: row.contactEmail,
      channel: 'email',
      template: 'part.quoted',
      payload: { price: body.quotedPrice.toFixed(2), note: body.quoteNote },
    });
    return updated;
  }
}

@ApiTags('part-requests')
@Controller()
export class PartRequestsAdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('admin/part-requests')
  @Permissions('procurement.manage')
  queue() {
    return this.prisma.partRequest.findMany({
      include: { customer: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}

@Module({ controllers: [PartRequestsController, PartRequestsAdminController] })
export class PartRequestsModule {}
