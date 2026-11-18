export function money(value: { toFixed(digits: number): string } | string | number | null | undefined): string {
  if (value == null) return '0.00';
  if (typeof value === 'object' && 'toFixed' in value) return value.toFixed(2);
  return Number(value).toFixed(2);
}

export function moneyNumber(value: { toString(): string } | string | number): number {
  return Number(typeof value === 'object' ? value.toString() : value);
}
