const IMPORT_STEPS = ['planned', 'booked', 'departed', 'arrived', 'customs', 'cleared', 'delivered'] as const;

export type ImportStep = (typeof IMPORT_STEPS)[number];

export function nextImportStep(current: string): ImportStep | null {
  const index = IMPORT_STEPS.indexOf(current as ImportStep);
  if (index < 0 || index === IMPORT_STEPS.length - 1) return null;
  return IMPORT_STEPS[index + 1];
}

export function canAdvanceImport(current: string, next: string): boolean {
  return nextImportStep(current) === next;
}

export function slaDueAt(priority: string, from = new Date()): Date {
  const hours = priority === 'urgent' ? 4 : priority === 'high' ? 8 : priority === 'low' ? 72 : 24;
  return new Date(from.getTime() + hours * 60 * 60 * 1000);
}

export function parseGigBooking(payload: unknown): { trackingNo: string | null; labelUrl: string | null } {
  const root = asRecord(payload);
  const data = asRecord(root.data);
  const nested = asRecord(data.data);
  const source = Object.keys(nested).length ? nested : Object.keys(data).length ? data : root;
  return {
    trackingNo: stringField(source, ['Waybill', 'waybill', 'WaybillNumber', 'waybillNumber']),
    labelUrl: stringField(source, ['LabelUrl', 'labelUrl', 'Label']),
  };
}

export function parseDhlBooking(payload: unknown): { trackingNo: string | null; labelUrl: string | null; productCode: string | null } {
  const root = asRecord(payload);
  const documents = Array.isArray(root.documents) ? root.documents : [];
  const first = asRecord(documents[0]);
  const products = Array.isArray(root.products) ? root.products : [];
  const product = asRecord(products[0]);
  return {
    trackingNo: stringField(root, ['shipmentTrackingNumber']),
    labelUrl: stringField(first, ['url']),
    productCode: stringField(product, ['productCode']),
  };
}

export function parseDhlRate(payload: unknown): { amount: number; currency: string; productCode: string } | null {
  const root = asRecord(payload);
  const products = Array.isArray(root.products) ? root.products : [];
  const product = asRecord(products[0]);
  if (!Object.keys(product).length) return null;
  const prices = Array.isArray(product.totalPrice) ? product.totalPrice : [];
  const billed = prices.find((item) => asRecord(item).currencyType === 'BILLC') ?? prices[0];
  const price = asRecord(billed);
  if (typeof price.price !== 'number') return null;
  const code = stringField(product, ['productCode']);
  if (!code) return null;
  return { amount: price.price, currency: typeof price.priceCurrency === 'string' ? price.priceCurrency : 'NGN', productCode: code };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringField(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}
