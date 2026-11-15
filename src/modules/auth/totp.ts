import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function encodeBase32(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function decodeBase32(input: string): Buffer {
  const clean = input.replace(/=+$/g, '').replace(/\s/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error('Invalid base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(): string {
  return encodeBase32(randomBytes(20));
}

export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export function totp(secret: Buffer, timeMs = Date.now(), stepSeconds = 30, digits = 6): string {
  return hotp(secret, Math.floor(timeMs / 1000 / stepSeconds), digits);
}

export function verifyTotp(
  secret: Buffer,
  code: string,
  lastStep: number | null,
  timeMs = Date.now(),
  window = 1,
): number | null {
  const step = Math.floor(timeMs / 1000 / 30);
  for (let offset = -window; offset <= window; offset += 1) {
    const candidate = step + offset;
    if (lastStep != null && candidate <= lastStep) continue;
    const expected = hotp(secret, candidate);
    if (expected.length === code.length && timingSafeEqual(Buffer.from(expected), Buffer.from(code))) return candidate;
  }
  return null;
}

export function otpauthUrl(account: string, secret: string): string {
  const label = encodeURIComponent(`PROMEC:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=PROMEC&algorithm=SHA1&digits=6&period=30`;
}
