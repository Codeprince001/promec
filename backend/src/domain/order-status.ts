export const ORDER_STATUSES = [
  'pending_payment',
  'payment_failed',
  'paid',
  'awaiting_stock',
  'processing',
  'packed',
  'dispatched',
  'delivered',
  'completed',
  'cancelled',
  'return_requested',
  'returned',
] as const;

export type OrderState = (typeof ORDER_STATUSES)[number];

const TRANSITIONS: Record<OrderState, OrderState[]> = {
  pending_payment: ['paid', 'cancelled', 'payment_failed'],
  payment_failed: ['pending_payment', 'cancelled'],
  paid: ['processing', 'awaiting_stock', 'cancelled'],
  awaiting_stock: ['processing', 'cancelled'],
  processing: ['packed', 'cancelled'],
  packed: ['dispatched'],
  dispatched: ['delivered'],
  delivered: ['completed', 'return_requested'],
  return_requested: ['returned', 'completed'],
  returned: [],
  completed: [],
  cancelled: [],
};

export function canTransition(from: OrderState, to: OrderState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: OrderState, to: OrderState): void {
  if (!canTransition(from, to)) {
    throw new Error(`Cannot move an order from ${from} to ${to}`);
  }
}
