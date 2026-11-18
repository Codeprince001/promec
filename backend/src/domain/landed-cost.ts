export type LandedCostInput = {
  unitPriceFx: number;
  fxRate: number;
  freightAlloc: number;
  insuranceAlloc: number;
  dutyAlloc: number;
  clearingAlloc: number;
  bankAlloc: number;
  handlingPerUnit: number;
  fxBufferPct: number;
  targetMargin: number;
  floorPrice: number;
};

export type LandedCostResult = {
  landedUnitCost: number;
  sellingPrice: number;
};

export function landedCost(input: LandedCostInput): LandedCostResult {
  if (input.targetMargin >= 1 || input.targetMargin < 0) {
    throw new Error('targetMargin must be between 0 and 1');
  }
  const productCost = input.unitPriceFx * input.fxRate;
  const base =
    productCost +
    input.freightAlloc +
    input.insuranceAlloc +
    input.dutyAlloc +
    input.clearingAlloc +
    input.bankAlloc +
    input.handlingPerUnit;
  const landedUnitCost = roundMoney(base * (1 + input.fxBufferPct));
  const fromMargin = landedUnitCost / (1 - input.targetMargin);
  return {
    landedUnitCost,
    sellingPrice: roundMoney(Math.max(input.floorPrice, fromMargin)),
  };
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
