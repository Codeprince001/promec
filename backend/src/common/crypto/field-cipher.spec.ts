import { decryptField, encryptField, encryptionKey } from './field-cipher';

const key = encryptionKey('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');

describe('field cipher', () => {
  it('round-trips a VIN', () => {
    const payload = encryptField('JTDBR32E720123456', key);
    expect(payload).not.toContain('JTDBR32E720123456');
    expect(decryptField(payload, key)).toBe('JTDBR32E720123456');
  });

  it('rejects a tampered payload', () => {
    const payload = encryptField('LAG-123-AB', key);
    const buf = Buffer.from(payload, 'base64url');
    buf[buf.length - 1] ^= 0xff;
    expect(() => decryptField(buf.toString('base64url'), key)).toThrow();
  });

  it('rejects a key that is not 32 bytes', () => {
    expect(() => encryptionKey('short')).toThrow(/32 bytes/);
  });
});
