import { createHmac } from 'crypto';
import { paystackSignature, signaturesMatch } from './paystack.signature';

describe('Paystack webhook signature', () => {
  const secret = 'sk_test_promec';
  const raw = Buffer.from('{"event":"charge.success","data":{"reference":"PAY-1","amount":4850000}}');

  it('matches Node HMAC-SHA512 over the raw body', () => {
    const expected = createHmac('sha512', secret).update(raw).digest('hex');
    expect(paystackSignature(secret, raw)).toBe(expected);
    expect(signaturesMatch(expected, expected)).toBe(true);
  });

  it('rejects a missing or different signature', () => {
    const expected = paystackSignature(secret, raw);
    expect(signaturesMatch(expected, undefined)).toBe(false);
    expect(signaturesMatch(expected, `${expected.slice(0, -1)}a`)).toBe(false);
    expect(signaturesMatch(expected, 'short')).toBe(false);
  });
});
