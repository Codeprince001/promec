import { auditEntryHash, auditPayload } from './audit-chain';

describe('audit hash chain', () => {
  const payload = auditPayload({ action: 'refund.approve', entityType: 'payment', entityId: 'pay-1', after: { amount: '100.00' } });

  it('changes when the previous hash changes', () => {
    const first = auditEntryHash(null, payload);
    const second = auditEntryHash(first, payload);
    expect(first).not.toBe(second);
    expect(auditEntryHash(null, payload)).toBe(first);
  });

  it('changes when the payload changes', () => {
    const other = auditPayload({ action: 'refund.approve', entityType: 'payment', entityId: 'pay-2' });
    expect(auditEntryHash(null, payload)).not.toBe(auditEntryHash(null, other));
  });
});
