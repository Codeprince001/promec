import { canAdvanceImport, parseDhlRate, parseGigBooking, slaDueAt } from './operations';

describe('operations', () => {
  it('advances an import one customs step at a time', () => {
    expect(canAdvanceImport('planned', 'booked')).toBe(true);
    expect(canAdvanceImport('planned', 'cleared')).toBe(false);
    expect(canAdvanceImport('delivered', 'booked')).toBe(false);
  });

  it('sets a shorter deadline for urgent tickets', () => {
    const from = new Date('2026-11-14T08:00:00.000Z');
    expect(slaDueAt('urgent', from).toISOString()).toBe('2026-11-14T12:00:00.000Z');
    expect(slaDueAt('normal', from).toISOString()).toBe('2026-11-15T08:00:00.000Z');
  });

  it('reads a GIG waybill from the nested payload', () => {
    expect(parseGigBooking({ data: { data: { Waybill: 'GW123', LabelUrl: 'https://labels.example/GW123' } } })).toEqual({
      trackingNo: 'GW123',
      labelUrl: 'https://labels.example/GW123',
    });
  });

  it('reads a DHL account rate', () => {
    expect(
      parseDhlRate({ products: [{ productCode: 'N', totalPrice: [{ currencyType: 'BILLC', price: 18500, priceCurrency: 'NGN' }] }] }),
    ).toEqual({ amount: 18500, currency: 'NGN', productCode: 'N' });
  });
});
