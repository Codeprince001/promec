export type CreditDecision = 'ok' | 'spending_limit' | 'credit_limit';

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function exposureOf(entries: { amount: number }[]): number {
  return roundMoney(entries.reduce((sum, entry) => sum + entry.amount, 0));
}

export function availableCredit(limit: number, exposure: number): number {
  return roundMoney(limit - exposure);
}

export function decideCredit(input: {
  limit: number;
  exposure: number;
  amount: number;
  spendingLimit: number | null;
}): CreditDecision {
  if (input.spendingLimit != null && input.amount > input.spendingLimit + 0.001) return 'spending_limit';
  if (input.exposure + input.amount > input.limit + 0.001) return 'credit_limit';
  return 'ok';
}

export function dueDate(termsDays: number, from = new Date()): Date {
  return new Date(from.getTime() + termsDays * 24 * 60 * 60 * 1000);
}
