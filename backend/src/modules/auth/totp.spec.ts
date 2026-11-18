import { hotp, verifyTotp } from './totp';

describe('TOTP', () => {
  const secret = Buffer.from('12345678901234567890');

  it('matches the RFC 6238 SHA1 vector', () => {
    expect(hotp(secret, 1, 8)).toBe('94287082');
    expect(hotp(secret, Math.floor(1111111109 / 30), 8)).toBe('07081804');
  });

  it('accepts the current step and rejects a reused step', () => {
    const atSeconds = 1_700_000_010;
    const code = hotp(secret, atSeconds / 30);
    const step = verifyTotp(secret, code, null, atSeconds * 1000);
    expect(step).toBe(atSeconds / 30);
    expect(verifyTotp(secret, code, step, atSeconds * 1000)).toBeNull();
  });

  it('rejects a code from outside the clock window', () => {
    const code = hotp(secret, 10);
    expect(verifyTotp(secret, code, null, 30 * 20 * 1000)).toBeNull();
  });
});
