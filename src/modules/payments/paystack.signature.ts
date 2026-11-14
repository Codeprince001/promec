import { createHmac, timingSafeEqual } from 'crypto';

export function paystackSignature(secret: string, rawBody: Buffer | string): string {
  return createHmac('sha512', secret).update(rawBody).digest('hex');
}

export function signaturesMatch(expected: string, received: string | undefined): boolean {
  if (!received) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
