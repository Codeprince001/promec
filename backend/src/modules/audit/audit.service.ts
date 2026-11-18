import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { auditEntryHash, auditPayload } from './audit-chain';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  log(
    entry: {
      actorId?: string | null;
      action: string;
      entityType: string;
      entityId?: string | null;
      before?: Prisma.InputJsonValue;
      after?: Prisma.InputJsonValue;
      ip?: string | null;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const write = async (db: Prisma.TransactionClient) => {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(8723461)`;
      const last = await db.auditLog.findFirst({ orderBy: { createdAt: 'desc' }, select: { entryHash: true } });
      const payload = auditPayload(entry);
      return db.auditLog.create({
        data: {
          actorId: entry.actorId ?? undefined,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? undefined,
          before: entry.before,
          after: entry.after,
          ip: entry.ip ?? undefined,
          prevHash: last?.entryHash,
          entryHash: auditEntryHash(last?.entryHash ?? null, payload),
        },
      });
    };
    return tx ? write(tx) : this.prisma.$transaction(write);
  }

  list(page: number, pageSize: number) {
    return this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.auditLog.count(),
    ]);
  }
}
