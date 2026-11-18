import { availableCredit, decideCredit, exposureOf } from './credit';

describe('trade credit', () => {
  it('nets orders against payments', () => {
    expect(exposureOf([{ amount: 50000 }, { amount: -20000 }])).toBe(30000);
    expect(availableCredit(100000, 30000)).toBe(70000);
  });

  it('refuses a draw above the account limit or the buyer spending limit', () => {
    expect(decideCredit({ limit: 100000, exposure: 80000, amount: 30000, spendingLimit: null })).toBe('credit_limit');
    expect(decideCredit({ limit: 100000, exposure: 0, amount: 40000, spendingLimit: 25000 })).toBe('spending_limit');
    expect(decideCredit({ limit: 100000, exposure: 20000, amount: 40000, spendingLimit: 50000 })).toBe('ok');
  });
});
