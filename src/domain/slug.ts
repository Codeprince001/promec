import { randomBytes } from 'crypto';

export function slugify(value: string): string {
  const base = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
  const suffix = randomBytes(2).toString('hex');
  return `${base || 'item'}-${suffix}`;
}

export function referenceCode(prefix: string): string {
  const time = Date.now().toString(36).toUpperCase();
  const rand = randomBytes(2).toString('hex').toUpperCase();
  return `${prefix}-${time}${rand}`;
}
