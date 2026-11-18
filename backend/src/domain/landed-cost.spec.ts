import { landedCost } from './landed-cost';

describe('landedCost', () => {
  it('adds allocated charges, applies the FX buffer, then the margin', () => {
    const result = landedCost({
      unitPriceFx: 20,
      fxRate: 1600,
      freightAlloc: 1500,
      insuranceAlloc: 200,
      dutyAlloc: 800,
      clearingAlloc: 400,
      bankAlloc: 100,
      handlingPerUnit: 50,
      fxBufferPct: 0.02,
      targetMargin: 0.25,
      floorPrice: 1000,
    });
    expect(result.landedUnitCost).toBe(35751);
    expect(result.sellingPrice).toBe(47668);
  });

  it('does not price below the floor', () => {
    const result = landedCost({
      unitPriceFx: 1,
      fxRate: 1,
      freightAlloc: 0,
      insuranceAlloc: 0,
      dutyAlloc: 0,
      clearingAlloc: 0,
      bankAlloc: 0,
      handlingPerUnit: 0,
      fxBufferPct: 0,
      targetMargin: 0.1,
      floorPrice: 5000,
    });
    expect(result.sellingPrice).toBe(5000);
  });
});
