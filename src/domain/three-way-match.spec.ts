import { receiptProgress, threeWayMatch } from './three-way-match';

describe('three-way match', () => {
  const line = {
    poItemId: 'item-1',
    orderedQty: 10,
    orderPrice: 25,
    acceptedQty: 10,
    invoicedQty: 10,
    invoicePrice: 25,
  };

  it('matches when the invoice agrees with the order and the accepted receipt', () => {
    expect(threeWayMatch([line]).status).toBe('matched');
  });

  it('allows a partial invoice that does not exceed the accepted quantity', () => {
    expect(threeWayMatch([{ ...line, invoicedQty: 4, acceptedQty: 6 }]).status).toBe('matched');
  });

  it('flags quantity billed beyond what quality control accepted', () => {
    const result = threeWayMatch([{ ...line, acceptedQty: 6 }]);
    expect(result.status).toBe('exception');
    expect(result.exceptions.map((item) => item.code)).toContain('not_received');
  });

  it('flags a price that is not the purchase-order price', () => {
    const result = threeWayMatch([{ ...line, invoicePrice: 30 }]);
    expect(result.exceptions.map((item) => item.code)).toContain('price_mismatch');
  });

  it('marks a purchase order received only after every line is accepted in full', () => {
    expect(receiptProgress([{ ordered: 5, received: 5, accepted: 5 }])).toBe('received');
    expect(receiptProgress([{ ordered: 5, received: 5, accepted: 2 }])).toBe('partially_received');
    expect(receiptProgress([{ ordered: 5, received: 0, accepted: 0 }])).toBe('issued');
  });
});
