export type WarehouseChoice = { warehouseId: string; state: string | null; available: number };

export function chooseWarehouse(rows: WarehouseChoice[], qty: number, preferredState?: string | null): string | null {
  const enough = rows.filter((row) => row.available >= qty);
  if (!enough.length) return null;
  const preferred = preferredState?.trim().toLowerCase() ?? '';
  enough.sort((left, right) => {
    const leftMatch = preferred && left.state?.toLowerCase() === preferred ? 1 : 0;
    const rightMatch = preferred && right.state?.toLowerCase() === preferred ? 1 : 0;
    if (leftMatch !== rightMatch) return rightMatch - leftMatch;
    return right.available - left.available;
  });
  return enough[0].warehouseId;
}

export function tradeUnitPrice(catalogue: number, discountRate: number, listPrice: number | null): { unit: number; discount: number } {
  const unit = listPrice == null ? round(catalogue * (1 - discountRate)) : round(listPrice);
  return { unit, discount: Math.max(0, round(catalogue - unit)) };
}

export function commissionAmount(merchandise: number, rate: number): number {
  return round(merchandise * rate);
}

const VIN_VALUES: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5,
  P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

export function assertVin(vin: string): string {
  const value = vin.trim().toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(value)) {
    throw new Error('A VIN is 17 characters and does not use I, O, or Q');
  }
  const total = [...value].reduce((sum, char, index) => sum + Number(VIN_VALUES[char] ?? char) * VIN_WEIGHTS[index], 0);
  const check = total % 11;
  const expected = check === 10 ? 'X' : String(check);
  if (value[8] !== expected) throw new Error('The VIN check digit does not match');
  return value;
}

export type DecodedVehicle = { make: string; model: string; year: number; displacementCc: number | null };

export type VariantCandidate = {
  id: string;
  make: string;
  model: string;
  yearFrom: number;
  yearTo: number;
  displacementCc: number | null;
};

export function matchVariant(decoded: DecodedVehicle, candidates: VariantCandidate[]): string | null {
  const make = decoded.make.trim().toLowerCase();
  const model = decoded.model.trim().toLowerCase();
  const fits = candidates.filter((row) => {
    const sameMake = row.make.trim().toLowerCase() === make;
    const sameModel = row.model.trim().toLowerCase() === model || row.model.trim().toLowerCase().includes(model) || model.includes(row.model.trim().toLowerCase());
    return sameMake && sameModel && decoded.year >= row.yearFrom && decoded.year <= row.yearTo;
  });
  if (!fits.length) return null;
  if (decoded.displacementCc == null) return fits[0].id;
  fits.sort((left, right) => {
    const leftGap = left.displacementCc == null ? Number.MAX_SAFE_INTEGER : Math.abs(left.displacementCc - decoded.displacementCc!);
    const rightGap = right.displacementCc == null ? Number.MAX_SAFE_INTEGER : Math.abs(right.displacementCc - decoded.displacementCc!);
    return leftGap - rightGap;
  });
  return fits[0].id;
}

function round(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
