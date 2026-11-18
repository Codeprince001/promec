export function normalizePartNumber(value: string): string {
  return value.toUpperCase().replace(/[\s.\-/_]/g, '');
}

export function looksLikePartNumber(value: string): boolean {
  const normalized = normalizePartNumber(value);
  return normalized.length >= 4 && /\d/.test(normalized) && /^[A-Z0-9]+$/.test(normalized);
}
