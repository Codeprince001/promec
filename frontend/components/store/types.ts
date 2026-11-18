export type StoreCard = {
  slug: string;
  businessName: string;
  logoUrl: string | null;
  bannerUrl: string | null;
  description: string | null;
  phone: string | null;
  address: { line: string | null; city: string | null; state: string | null; country: string };
  policies: string | null;
  ratingAvg: string;
  ratingCount: number;
  fulfilmentMode: string;
};

export type StoreProduct = {
  slug: string;
  name: string;
  media: { url: string; alt: string | null }[];
  skus: { price: { amount: string; currency: string }; availability: { status: string; qty: number } }[];
  store: { slug: string; businessName: string; logoUrl: string | null; ratingAvg: string; ratingCount: number } | null;
};

export type StoreReview = {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  author: string;
};

export function shipsFrom(mode: string) {
  return mode === 'vendor' ? 'Ships from this store' : 'Fulfilled by PROMEC';
}

export function addressLine(store: StoreCard) {
  return [store.address.line, store.address.city, store.address.state, store.address.country].filter(Boolean).join(', ');
}
