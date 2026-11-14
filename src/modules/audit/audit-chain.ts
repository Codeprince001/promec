import { createHash } from 'crypto';

export function auditPayload(entry: {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}): string {
  return JSON.stringify({
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
  });
}

export function auditEntryHash(previous: string | null, payload: string): string {
  return createHash('sha256').update(`${previous ?? 'genesis'}|${payload}`).digest('hex');
}
