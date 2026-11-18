export type FitmentState = 'confirmed' | 'probable' | 'unverified' | 'incompatible';

export type FitmentRow = {
  status: FitmentState;
  notes: string | null;
  sourceId: string | null;
  verifiedAt: Date | null;
  approvedById: string | null;
  vehicleVariantId: string | null;
  modelId: string | null;
  makeId: string | null;
  yearFrom: number | null;
  yearTo: number | null;
  engineId: string | null;
  position?: string | null;
  confidence?: number | null;
  validFrom?: Date | null;
  validTo?: Date | null;
};

export type FitmentVariant = {
  id: string;
  modelId: string;
  makeId: string;
  engineId: string | null;
  yearFrom: number;
  yearTo: number;
};

export type FitmentResult = {
  status: FitmentState;
  notes: string;
  position: string | null;
  confidence: number | null;
};

const EMPTY: FitmentResult = {
  status: 'unverified',
  notes: 'No verified fitment data for this vehicle.',
  position: null,
  confidence: null,
};

export function rowMatches(row: FitmentRow, variant: FitmentVariant, year?: number, now = new Date()): boolean {
  if (row.vehicleVariantId && row.vehicleVariantId !== variant.id) return false;
  if (row.modelId && row.modelId !== variant.modelId) return false;
  if (row.makeId && row.makeId !== variant.makeId) return false;
  if (row.engineId && row.engineId !== variant.engineId) return false;
  const selectedYear = year ?? variant.yearFrom;
  if (row.yearFrom != null && selectedYear < row.yearFrom) return false;
  if (row.yearTo != null && selectedYear > row.yearTo) return false;
  if (row.validFrom && row.validFrom > now) return false;
  if (row.validTo && row.validTo < now) return false;
  return true;
}

/**
 * Deterministic fitment decision. Exclusions win, then sourced confirmed
 * records, then reviewer-approved probable records. Anything else stays unverified.
 * This function never upgrades a status beyond the stored evidence.
 */
export function decideFitment(rows: FitmentRow[], variant: FitmentVariant, year?: number, now = new Date()): FitmentResult {
  const applicable = rows.filter((row) => rowMatches(row, variant, year, now));
  const exclusion = applicable.find((row) => row.status === 'incompatible');
  if (exclusion) {
    return {
      status: 'incompatible',
      notes: exclusion.notes ?? 'This part does not fit the selected vehicle.',
      position: exclusion.position ?? null,
      confidence: exclusion.confidence ?? 0,
    };
  }
  const confirmed = applicable.find((row) => row.status === 'confirmed' && row.sourceId && row.verifiedAt);
  if (confirmed) {
    return {
      status: 'confirmed',
      notes: confirmed.notes ?? 'Verified fit for this vehicle.',
      position: confirmed.position ?? null,
      confidence: confirmed.confidence ?? 1,
    };
  }
  const probable = applicable.find((row) => row.status === 'probable' && row.approvedById);
  if (probable) {
    return {
      status: 'probable',
      notes: probable.notes ?? 'Likely fit. Verify with VIN before purchase.',
      position: probable.position ?? null,
      confidence: probable.confidence ?? 0.7,
    };
  }
  return EMPTY;
}
