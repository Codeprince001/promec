import { bookTrackingNo, quoteCouriers, quoteGig } from './rates';

describe('courier rates', () => {
  it('prices a one-kilogram Lagos parcel on the GIG metro tariff', () => {
    expect(quoteGig('Lagos', 1000)).toMatchObject({ courier: 'gig', amount: '2200.00', etaDays: 1 });
  });

  it('offers the cheaper courier first', () => {
    const [first] = quoteCouriers('Abuja', 2000);
    expect(first.courier).toBe('gig');
    expect(Number(first.amount)).toBeLessThan(8800);
  });

  it('builds a tracking number from the courier and the order', () => {
    expect(bookTrackingNo('gig', 'PRM-9F3A21')).toBe('GIG-RM9F3A21');
  });
});
