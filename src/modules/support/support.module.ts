import { Body, Controller, Get, HttpStatus, Param, Post } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiException } from '../../common/api.exception';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { referenceCode } from '../../domain/slug';
import { PrismaService } from '../../prisma/prisma.service';

const ticketSchema = z.object({
  subject: z.string().min(3).max(160),
  body: z.string().min(3).max(5000),
  category: z.string().default('general'),
  email: z.string().email().optional(),
  orderId: z.string().uuid().optional(),
});
const messageSchema = z.object({ body: z.string().min(1).max(5000) });

@ApiTags('support')
@Controller()
export class SupportController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Post('support/tickets')
  async create(@CurrentUser() user: AuthUser | undefined, @Body({ schema: ticketSchema }) body: z.infer<typeof ticketSchema>) {
    const customer = user ? await this.prisma.customer.findUnique({ where: { userId: user.sub } }) : null;
    if (!customer && !body.email) {
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_ERROR', 'Email is required');
    }
    return this.prisma.supportTicket.create({
      data: {
        ticketNo: referenceCode('SUP'),
        customerId: customer?.id,
        requesterEmail: body.email,
        subject: body.subject,
        category: body.category,
        relatedOrderId: body.orderId,
        messages: { create: { authorId: user?.sub, body: body.body, isStaff: false } },
      },
      include: { messages: true },
    });
  }

  @Get('support/tickets')
  async mine(@CurrentUser() user: AuthUser) {
    const customer = await this.prisma.customer.findUnique({ where: { userId: user.sub } });
    if (!customer) return [];
    return this.prisma.supportTicket.findMany({
      where: { customerId: customer.id },
      include: { messages: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post('support/tickets/:id/messages')
  async reply(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body({ schema: messageSchema }) body: z.infer<typeof messageSchema>) {
    const customer = await this.prisma.customer.findUnique({ where: { userId: user.sub } });
    const ticket = await this.prisma.supportTicket.findFirst({ where: { id, customerId: customer?.id } });
    if (!ticket) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Ticket was not found');
    return this.prisma.ticketMessage.create({ data: { ticketId: id, authorId: user.sub, body: body.body, isStaff: false } });
  }

  @Get('admin/support/tickets')
  @Permissions('support.manage')
  inbox() {
    return this.prisma.supportTicket.findMany({ include: { messages: true }, orderBy: { updatedAt: 'desc' }, take: 100 });
  }

  @Post('admin/support/tickets/:id/messages')
  @Permissions('support.manage')
  staffReply(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body({ schema: messageSchema }) body: z.infer<typeof messageSchema>) {
    return this.prisma.ticketMessage.create({ data: { ticketId: id, authorId: user.sub, body: body.body, isStaff: true } });
  }
}

@Module({ controllers: [SupportController] })
export class SupportModule {}
