export type MatchLine = {
  poItemId: string;
  orderedQty: number;
  orderPrice: number;
  acceptedQty: number;
  invoicedQty: number;
  invoicePrice: number;
};

export type MatchException = {
  poItemId: string;
  code: 'unknown_item' | 'over_ordered' | 'not_received' | 'price_mismatch';
  message: string;
};

export function threeWayMatch(lines: MatchLine[], priceTolerance = 0.01): { status: 'matched' | 'exception'; exceptions: MatchException[] } {
  const exceptions: MatchException[] = [];
  if (!lines.length) {
    return { status: 'exception', exceptions: [{ poItemId: '', code: 'unknown_item', message: 'The invoice has no lines' }] };
  }
  for (const line of lines) {
    if (!line.poItemId) {
      exceptions.push({ poItemId: '', code: 'unknown_item', message: 'An invoice line is not on the purchase order' });
      continue;
    }
    if (line.invoicedQty > line.orderedQty) {
      exceptions.push({
        poItemId: line.poItemId,
        code: 'over_ordered',
        message: `Invoiced ${line.invoicedQty} exceeds the ordered ${line.orderedQty}`,
      });
    }
    if (line.invoicedQty > line.acceptedQty) {
      exceptions.push({
        poItemId: line.poItemId,
        code: 'not_received',
        message: `Invoiced ${line.invoicedQty} exceeds the accepted ${line.acceptedQty}`,
      });
    }
    if (Math.abs(line.invoicePrice - line.orderPrice) > priceTolerance) {
      exceptions.push({
        poItemId: line.poItemId,
        code: 'price_mismatch',
        message: `Invoice price ${line.invoicePrice.toFixed(2)} differs from the order price ${line.orderPrice.toFixed(2)}`,
      });
    }
  }
  return { status: exceptions.length ? 'exception' : 'matched', exceptions };
}

export function receiptProgress(lines: { ordered: number; received: number; accepted: number }[]): 'issued' | 'partially_received' | 'received' {
  if (lines.length > 0 && lines.every((line) => line.ordered > 0 && line.accepted >= line.ordered)) return 'received';
  if (lines.some((line) => line.received > 0)) return 'partially_received';
  return 'issued';
}
