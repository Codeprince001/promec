import { decideFitment, type FitmentRow, type FitmentVariant } from './fitment';

const variant: FitmentVariant = {
  id: 'vv_camry',
  modelId: 'camry',
  makeId: 'toyota',
  engineId: '2ar',
  yearFrom: 2012,
  yearTo: 2017,
};

const base = (overrides: Partial<FitmentRow>): FitmentRow => ({
  status: 'confirmed',
  notes: null,
  sourceId: 'src',
  verifiedAt: new Date('2026-01-01'),
  approvedById: null,
  vehicleVariantId: variant.id,
  modelId: null,
  makeId: null,
  yearFrom: 2012,
  yearTo: 2017,
  engineId: null,
  ...overrides,
});

describe('decideFitment', () => {
  it('returns unverified when no evidence matches', () => {
    expect(decideFitment([], variant).status).toBe('unverified');
  });

  it('lets an exclusion win over a confirmed row', () => {
    const result = decideFitment(
      [
        base({ status: 'confirmed', notes: 'fits' }),
        base({ status: 'incompatible', notes: 'hybrid only', sourceId: 'src', verifiedAt: new Date() }),
      ],
      variant,
    );
    expect(result.status).toBe('incompatible');
    expect(result.notes).toBe('hybrid only');
  });

  it('requires a source and verification date before confirming', () => {
    const result = decideFitment([base({ sourceId: null, verifiedAt: null, notes: 'guess' })], variant);
    expect(result.status).toBe('unverified');
  });

  it('confirms when sourced evidence matches the variant', () => {
    const result = decideFitment([base({ notes: '2.5L only', position: 'front' })], variant, 2015);
    expect(result).toMatchObject({ status: 'confirmed', position: 'front', confidence: 1 });
  });

  it('returns probable only when a reviewer approved the rule', () => {
    const withoutReview = decideFitment(
      [base({ status: 'probable', sourceId: null, verifiedAt: null, approvedById: null })],
      variant,
    );
    expect(withoutReview.status).toBe('unverified');
    const reviewed = decideFitment(
      [base({ status: 'probable', sourceId: null, verifiedAt: null, approvedById: 'usr', notes: 'shared platform' })],
      variant,
    );
    expect(reviewed.status).toBe('probable');
  });

  it('ignores rows outside the selected year', () => {
    const result = decideFitment([base({ yearFrom: 2018, yearTo: 2022 })], variant, 2015);
    expect(result.status).toBe('unverified');
  });
});
