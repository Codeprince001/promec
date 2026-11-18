import { assertVin, chooseWarehouse, commissionAmount, matchVariant, tradeUnitPrice, withdrawableBalance } from './commerce';

describe('commerce', () => {
  it('reserves from the warehouse in the delivery state when it can fill the line', () => {
    const chosen = chooseWarehouse([
      { warehouseId: 'lagos', state: 'Lagos', available: 4 },
      { warehouseId: 'abuja', state: 'Abuja', available: 20 },
    ], 2, 'Lagos');
    expect(chosen).toBe('lagos');
  });

  it('uses another warehouse when the local one cannot fill the line', () => {
    const chosen = chooseWarehouse([
      { warehouseId: 'lagos', state: 'Lagos', available: 1 },
      { warehouseId: 'abuja', state: 'Abuja', available: 6 },
    ], 4, 'Lagos');
    expect(chosen).toBe('abuja');
  });

  it('lets a contract price replace the account discount', () => {
    expect(tradeUnitPrice(10000, 0.1, 8000)).toEqual({ unit: 8000, discount: 2000 });
    expect(tradeUnitPrice(10000, 0.1, null)).toEqual({ unit: 9000, discount: 1000 });
  });

  it('checks a real VIN and matches the catalogue variant', () => {
    expect(assertVin('1hgcm82633a004352')).toBe('1HGCM82633A004352');
    expect(matchVariant(
      { make: 'Honda', model: 'Accord', year: 2003, displacementCc: 2400 },
      [
        { id: 'other', make: 'Toyota', model: 'Camry', yearFrom: 2002, yearTo: 2006, displacementCc: 2400 },
        { id: 'accord', make: 'Honda', model: 'Accord', yearFrom: 1998, yearTo: 2007, displacementCc: 2354 },
      ],
    )).toBe('accord');
  });

  it('rejects a VIN with a bad check digit', () => {
    expect(() => assertVin('1HGCM82633A004353')).toThrow(/check digit/);
  });

  it('calculates vendor commission on merchandise', () => {
    expect(commissionAmount(48500, 0.12)).toBe(5820);
  });

  it('keeps requested withdrawals out of the amount a vendor can take', () => {
    expect(withdrawableBalance(20000, 7500)).toBe(12500);
    expect(withdrawableBalance(4000, 6000)).toBe(0);
  });
});
