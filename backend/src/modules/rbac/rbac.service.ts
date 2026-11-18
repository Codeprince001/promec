import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { warehouseScope, type RoleGrant } from './rbac.scope';

const PERMISSIONS: { code: string; module: string; description: string }[] = [
  { code: '*', module: 'platform', description: 'All permissions' },
  { code: 'catalogue.manage', module: 'catalogue', description: 'Create and edit products' },
  { code: 'compatibility.manage', module: 'compatibility', description: 'Edit fitment records' },
  { code: 'compatibility.confirm', module: 'compatibility', description: 'Confirm fitment' },
  { code: 'inventory.manage', module: 'inventory', description: 'Adjust stock' },
  { code: 'orders.manage', module: 'orders', description: 'Manage every order' },
  { code: 'orders.refund.approve', module: 'orders', description: 'Approve refunds' },
  { code: 'payments.manage', module: 'payments', description: 'Confirm payments and refunds' },
  { code: 'support.manage', module: 'support', description: 'Manage support tickets' },
  { code: 'users.manage', module: 'users', description: 'Manage users and roles' },
  { code: 'procurement.manage', module: 'procurement', description: 'Manage suppliers, POs and imports' },
  { code: 'vendors.manage', module: 'vendors', description: 'Approve marketplace vendors' },
  { code: 'b2b.manage', module: 'b2b', description: 'Approve business accounts and quotes' },
  { code: 'analytics.view', module: 'analytics', description: 'View operational dashboards' },
  { code: 'audit.view', module: 'audit', description: 'Read the audit log' },
  { code: 'promotions.manage', module: 'promotions', description: 'Manage coupons' },
];

const ROLE_PERMISSIONS: Record<string, string[]> = {
  customer: [],
  super_admin: ['*'],
  warehouse: ['inventory.manage', 'orders.manage'],
  support: ['support.manage', 'orders.manage'],
  procurement: ['procurement.manage', 'catalogue.manage', 'compatibility.manage', 'compatibility.confirm', 'inventory.manage'],
  finance: ['payments.manage', 'orders.refund.approve', 'analytics.view', 'audit.view'],
};

@Injectable()
export class RbacService implements OnModuleInit {
  private readonly logger = new Logger(RbacService.name);
  private readonly cache = new Map<string, { at: number; codes: Set<string> }>();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    try {
      await this.ensureDefaults();
    } catch (error) {
      this.logger.warn(`RBAC defaults were not seeded: ${String(error)}`);
    }
  }

  async ensureDefaults() {
    for (const permission of PERMISSIONS) {
      await this.prisma.permission.upsert({
        where: { code: permission.code },
        update: { description: permission.description, module: permission.module },
        create: permission,
      });
    }
    for (const [name, codes] of Object.entries(ROLE_PERMISSIONS)) {
      const role = await this.prisma.role.upsert({
        where: { name },
        update: {},
        create: { name, description: `${name} role` },
      });
      for (const code of codes) {
        const permission = await this.prisma.permission.findUniqueOrThrow({ where: { code } });
        const scope = name === 'warehouse' ? 'warehouse' : 'all';
        await this.prisma.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
          update: { scope },
          create: { roleId: role.id, permissionId: permission.id, scope },
        });
      }
    }
  }

  async assignRole(userId: string, roleName: string, warehouseId?: string) {
    const role = await this.prisma.role.findUniqueOrThrow({ where: { name: roleName } });
    await this.prisma.userRole.upsert({
      where: { userId_roleId: { userId, roleId: role.id } },
      update: warehouseId ? { warehouseId } : {},
      create: { userId, roleId: role.id, warehouseId },
    });
    this.cache.delete(userId);
  }

  async revokeRole(userId: string, roleName: string) {
    const role = await this.prisma.role.findUnique({ where: { name: roleName } });
    if (!role) return { revoked: false };
    await this.prisma.userRole.deleteMany({ where: { userId, roleId: role.id } });
    this.cache.delete(userId);
    return { revoked: true };
  }

  async codesForUser(userId: string): Promise<Set<string>> {
    const cached = this.cache.get(userId);
    if (cached && Date.now() - cached.at < 30_000) return cached.codes;
    const rows = await this.prisma.userRole.findMany({
      where: { userId },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });
    const codes = new Set<string>();
    for (const row of rows) {
      if (row.role.name === 'super_admin') codes.add('*');
      for (const link of row.role.permissions) codes.add(link.permission.code);
    }
    this.cache.set(userId, { at: Date.now(), codes });
    return codes;
  }

  async warehouseIds(userId: string, permission: string) {
    const rows = await this.prisma.userRole.findMany({
      where: { userId },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });
    const grants: RoleGrant[] = rows.map((row) => ({
      superAdmin: row.role.name === 'super_admin',
      warehouseId: row.warehouseId,
      permissions: row.role.permissions.map((link) => ({ code: link.permission.code, scope: link.scope })),
    }));
    return warehouseScope(grants, permission);
  }

  async listRoles() {
    return this.prisma.role.findMany({
      include: { permissions: { include: { permission: true } } },
      orderBy: { name: 'asc' },
    });
  }
}
