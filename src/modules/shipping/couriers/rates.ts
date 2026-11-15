export type CourierOffer = {
  courier: 'gig' | 'dhl';
  service: string;
  amount: string;
  currency: 'NGN';
  etaDays: number;
  source?: 'carrier' | 'tariff';
};

const SOUTH_WEST = new Set(['lagos', 'ogun', 'oyo', 'osun', 'ondo', 'ekiti']);

function kgOf(weightG: number) {
  return Math.max(weightG / 1000, 0.5);
}

export function quoteGig(state: string, weightG: number): CourierOffer {
  const name = state.trim().toLowerCase();
  const kg = kgOf(weightG);
  const lagos = name === 'lagos';
  const south = SOUTH_WEST.has(name);
  const base = lagos ? 1800 : south ? 2500 : 4200;
  const perKg = lagos ? 400 : south ? 550 : 750;
  return {
    courier: 'gig',
    service: lagos ? 'Lagos metro' : south ? 'South west' : 'Interstate',
    amount: (base + perKg * kg).toFixed(2),
    currency: 'NGN',
    etaDays: lagos ? 1 : south ? 2 : 4,
  };
}

export function quoteDhl(state: string, weightG: number): CourierOffer {
  const lagos = state.trim().toLowerCase() === 'lagos';
  const kg = kgOf(weightG);
  const base = lagos ? 6200 : 8800;
  return {
    courier: 'dhl',
    service: lagos ? 'Lagos express' : 'Nationwide express',
    amount: (base + 1400 * kg).toFixed(2),
    currency: 'NGN',
    etaDays: lagos ? 1 : 2,
  };
}

export function quoteCouriers(state: string, weightG: number): CourierOffer[] {
  return [quoteGig(state, weightG), quoteDhl(state, weightG)].sort((left, right) => Number(left.amount) - Number(right.amount));
}

export function bookTrackingNo(courier: string, orderNo: string): string {
  const suffix = orderNo.replace(/[^A-Za-z0-9]/g, '').slice(-8).toUpperCase();
  return `${courier.toUpperCase()}-${suffix}`;
}
