import { Body, Controller, Get, HttpStatus, Param, Post } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiException } from '../../common/api.exception';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { slaDueAt } from '../../domain/operations';
import { referenceCode } from '../../domain/slug';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const ticketSchema = z.object({
  subject: z.string().min(3).max(160),
  body: z.string().min(3).max(5000),
  category: z.string().default('general'),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  email: z.string().email().optional(),
  orderId: z.string().uuid().optional(),
});
const messageSchema = z.object({ body: z.string().min(1).max(5000) });

@ApiTags('support')
@Controller()
export class SupportController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

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
        priority: body.priority,
        dueAt: slaDueAt(body.priority),
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
  async staffReply(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body({ schema: messageSchema }) body: z.infer<typeof messageSchema>) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id }, include: { customer: true } });
    if (!ticket) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Ticket was not found');
    const message = await this.prisma.ticketMessage.create({ data: { ticketId: id, authorId: user.sub, body: body.body, isStaff: true } });
    if (!ticket.firstResponseAt) {
      await this.prisma.supportTicket.update({ where: { id }, data: { firstResponseAt: new Date(), status: 'pending' } });
    }
    await this.notifications.enqueue({
      userId: ticket.customer?.userId,
      to: ticket.requesterEmail,
      channel: 'email',
      template: 'ticket.reply',
      payload: { ticketNo: ticket.ticketNo },
    });
    return message;
  }

  @Get('admin/support/tickets/:id')
  @Permissions('support.manage')
  async one(@Param('id') id: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id }, include: { messages: { orderBy: { createdAt: 'asc' } }, customer: true, assignee: { select: { id: true, email: true } } } });
    if (!ticket) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Ticket was not found');
    return ticket;
  }

  @Post('admin/support/tickets/:id/close')
  @Permissions('support.manage')
  async close(@Param('id') id: string, @Body({ schema: z.object({ status: z.enum(['resolved', 'closed']) }) }) body: { status: 'resolved' | 'closed' }) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Ticket was not found');
    return this.prisma.supportTicket.update({ where: { id }, data: { status: body.status } });
  }

  @Post('admin/support/tickets/:id/assign')
  @Permissions('support.manage')
  async assign(@Param('id') id: string, @Body({ schema: z.object({ assigneeId: z.string().uuid(), priority: z.enum(['low', 'normal', 'high', 'urgent']).optional() }) }) body: { assigneeId: string; priority?: 'low' | 'normal' | 'high' | 'urgent' }) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Ticket was not found');
    const priority = body.priority ?? ticket.priority;
    return this.prisma.supportTicket.update({
      where: { id },
      data: { assigneeId: body.assigneeId, priority, dueAt: slaDueAt(priority, ticket.createdAt) },
    });
  }
}

@Module({ controllers: [SupportController] })
export class SupportModule {}
