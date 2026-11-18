import { randomBytes } from 'crypto';
import { Body, Controller, Delete, Get, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { pageMeta } from '../../common/pagination';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiException } from '../../common/api.exception';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { hashPassword } from '../auth/password';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { RbacService } from '../rbac/rbac.service';

const addressSchema = z.object({
  label: z.string().max(40).optional(),
  recipient: z.string().min(1),
  phone: z.string().min(8),
  state: z.string().min(2),
  lga: z.string().optional(),
  city: z.string().min(1),
  street: z.string().min(1),
  landmark: z.string().optional(),
  isDefaultShipping: z.boolean().optional(),
  isDefaultBilling: z.boolean().optional(),
});

async function customerOf(prisma: PrismaService, userId: string) {
  const customer = await prisma.customer.findUnique({ where: { userId } });
  if (!customer) throw new ApiException(HttpStatus.FORBIDDEN, 'CUSTOMER_REQUIRED', 'A customer profile is required');
  return customer;
}

const staffSchema = z.object({
  email: z.string().email(),
  role: z.string().min(2).max(40),
  phone: z.string().min(8).max(20).optional(),
  warehouseId: z.string().uuid().optional(),
});

@ApiTags('account')
@Controller()
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  @Post('admin/users')
  @Permissions('users.manage')
  async invite(@CurrentUser() actor: AuthUser, @Body({ schema: staffSchema }) body: z.infer<typeof staffSchema>) {
    await this.assertRoleGrant(actor.sub, body.role);
    const email = body.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'That email already has an account');
    const user = await this.prisma.user.create({
      data: {
        email,
        phone: body.phone,
        passwordHash: await hashPassword(randomBytes(24).toString('hex')),
        userType: 'staff',
        status: 'active',
        emailVerifiedAt: new Date(),
      },
    });
    await this.rbac.assignRole(user.id, body.role, body.warehouseId);
    await this.auth.requestPasswordReset(email);
    await this.audit.log({ actorId: actor.sub, action: 'staff.invite', entityType: 'user', entityId: user.id, after: { email, role: body.role } });
    return { id: user.id, email, role: body.role };
  }

  @Patch('admin/users/:id')
  @Permissions('users.manage')
  async setStaffStatus(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body({ schema: z.object({ status: z.enum(['active', 'disabled', 'pending']) }) }) body: { status: 'active' | 'disabled' | 'pending' },
  ) {
    if (id === actor.sub && body.status !== 'active') {
      throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'You cannot disable your own account');
    }
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user || user.deletedAt) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'User was not found');
    await this.prisma.user.update({ where: { id }, data: { status: body.status } });
    if (body.status !== 'active') {
      await this.prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await this.audit.log({ actorId: actor.sub, action: 'user.status', entityType: 'user', entityId: id, before: { status: user.status }, after: { status: body.status } });
    return { id, status: body.status };
  }

  @Post('admin/users/:id/roles')
  @Permissions('users.manage')
  async grantRole(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body({ schema: z.object({ role: z.string().min(2).max(40), warehouseId: z.string().uuid().optional() }) }) body: { role: string; warehouseId?: string },
  ) {
    await this.assertRoleGrant(actor.sub, body.role);
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user || user.deletedAt) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'User was not found');
    await this.rbac.assignRole(id, body.role, body.warehouseId);
    await this.audit.log({ actorId: actor.sub, action: 'role.grant', entityType: 'user', entityId: id, after: { role: body.role, warehouseId: body.warehouseId ?? null } });
    return { id, role: body.role };
  }

  @Delete('admin/users/:id/roles/:roleName')
  @Permissions('users.manage')
  async revokeRole(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Param('roleName') roleName: string) {
    if (id === actor.sub && roleName === 'super_admin') {
      throw new ApiException(HttpStatus.CONFLICT, 'CONFLICT', 'You cannot remove your own super admin role');
    }
    const result = await this.rbac.revokeRole(id, roleName);
    await this.audit.log({ actorId: actor.sub, action: 'role.revoke', entityType: 'user', entityId: id, after: { role: roleName } });
    return result;
  }

  @Patch('admin/customers/:id')
  @Permissions('users.manage')
  async setCustomerStatus(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body({ schema: z.object({ status: z.enum(['active', 'disabled']) }) }) body: { status: 'active' | 'disabled' },
  ) {
    const customer = await this.prisma.customer.findUnique({ where: { id }, include: { user: true } });
    if (!customer) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Customer was not found');
    await this.prisma.user.update({ where: { id: customer.userId }, data: { status: body.status } });
    if (body.status === 'disabled') {
      await this.prisma.session.updateMany({ where: { userId: customer.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await this.audit.log({ actorId: actor.sub, action: 'customer.status', entityType: 'customer', entityId: id, before: { status: customer.user.status }, after: { status: body.status } });
    return { id, status: body.status };
  }

  private async assertRoleGrant(actorId: string, role: string) {
    const known = await this.prisma.role.findUnique({ where: { name: role } });
    if (!known) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_ERROR', 'That role does not exist');
    const codes = await this.rbac.codesForUser(actorId);
    if (role === 'super_admin' && !codes.has('*')) {
      throw new ApiException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Only a super admin can grant that role');
    }
  }

  @Get('admin/users')
  @Permissions('users.manage')
  async staff() {
    const rows = await this.prisma.user.findMany({
      where: { deletedAt: null, userType: { in: ['staff', 'vendor'] } },
      include: { roles: { include: { role: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      phone: row.phone,
      type: row.userType,
      status: row.status,
      mfaEnabled: row.mfaEnabled,
      roles: row.roles.map((link) => link.role.name),
    }));
  }

  @Get('admin/customers')
  @Permissions('users.manage')
  async customers(@Query({ schema: z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20), q: z.string().optional() }) }) query: { page: number; pageSize: number; q?: string }) {
    const q = query.q?.trim();
    const where = q
      ? {
          OR: [
            { firstName: { contains: q, mode: 'insensitive' as const } },
            { lastName: { contains: q, mode: 'insensitive' as const } },
            { user: { email: { contains: q, mode: 'insensitive' as const } } },
          ],
        }
      : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        include: { user: { select: { email: true, phone: true, status: true } }, _count: { select: { orders: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.customer.count({ where }),
    ]);
    return {
      data: rows.map((row) => ({
        id: row.id,
        firstName: row.firstName,
        lastName: row.lastName,
        customerType: row.customerType,
        email: row.user.email,
        phone: row.user.phone,
        status: row.user.status,
        orders: row._count.orders,
        createdAt: row.createdAt.toISOString(),
      })),
      meta: pageMeta(query.page, query.pageSize, total),
    };
  }

  @Get('me/addresses')
  async addresses(@CurrentUser() user: AuthUser) {
    const customer = await customerOf(this.prisma, user.sub);
    return this.prisma.customerAddress.findMany({ where: { customerId: customer.id }, orderBy: { createdAt: 'desc' } });
  }

  @Post('me/addresses')
  async addAddress(@CurrentUser() user: AuthUser, @Body({ schema: addressSchema }) body: z.infer<typeof addressSchema>) {
    const customer = await customerOf(this.prisma, user.sub);
    if (body.isDefaultShipping) {
      await this.prisma.customerAddress.updateMany({ where: { customerId: customer.id }, data: { isDefaultShipping: false } });
    }
    return this.prisma.customerAddress.create({ data: { ...body, customerId: customer.id } });
  }

  @Patch('me/addresses/:id')
  async updateAddress(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body({ schema: addressSchema.partial() }) body: Partial<z.infer<typeof addressSchema>>,
  ) {
    const customer = await customerOf(this.prisma, user.sub);
    const address = await this.prisma.customerAddress.findFirst({ where: { id, customerId: customer.id } });
    if (!address) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Address was not found');
    return this.prisma.customerAddress.update({ where: { id }, data: body });
  }

  @Delete('me/addresses/:id')
  async deleteAddress(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const customer = await customerOf(this.prisma, user.sub);
    const address = await this.prisma.customerAddress.findFirst({ where: { id, customerId: customer.id } });
    if (!address) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Address was not found');
    await this.prisma.customerAddress.delete({ where: { id } });
    return { deleted: true };
  }

  @Get('wishlist')
  async wishlist(@CurrentUser() user: AuthUser) {
    const customer = await customerOf(this.prisma, user.sub);
    return this.prisma.wishlistItem.findMany({
      where: { customerId: customer.id },
      include: { sku: { include: { product: true } } },
    });
  }

  @Post('wishlist')
  async save(@CurrentUser() user: AuthUser, @Body({ schema: z.object({ skuId: z.string().uuid() }) }) body: { skuId: string }) {
    const customer = await customerOf(this.prisma, user.sub);
    return this.prisma.wishlistItem.upsert({
      where: { customerId_skuId: { customerId: customer.id, skuId: body.skuId } },
      update: {},
      create: { customerId: customer.id, skuId: body.skuId },
    });
  }

  @Delete('wishlist/:skuId')
  async unsave(@CurrentUser() user: AuthUser, @Param('skuId') skuId: string) {
    const customer = await customerOf(this.prisma, user.sub);
    await this.prisma.wishlistItem.deleteMany({ where: { customerId: customer.id, skuId } });
    return { deleted: true };
  }
}
