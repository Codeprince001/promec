export type ProductCardData = {
  id?: string;
  slug: string;
  name: string;
  description?: string | null;
  manufacturer?: { id: string; name: string };
  category?: { slug: string; name: string };
  media?: { url: string; alt: string | null }[];
  skus: { id: string; sku?: string; price: { amount: string; currency: string }; availability?: { status: string; qty: number } }[];
  store?: { slug: string; businessName: string; logoUrl?: string | null; ratingAvg?: string; ratingCount?: number } | null;
};

export type CartLine = {
  id: string;
  skuId: string;
  sku: string;
  name: string;
  slug: string;
  qty: number;
  unitPrice: string;
  lineTotal: string;
  fitmentStatus: string | null;
};

export type CartBody = {
  data: { id: string; guestToken: string | null; currency: string; items: CartLine[]; subtotal: string };
  meta?: { guestToken?: string | null };
};

export type OrderBody = {
  id: string;
  orderNo: string;
  status: string;
  paymentStatus: string;
  grandTotal: string;
  subtotal: string;
  shippingTotal: string;
  discountTotal: string;
  currency: string;
  placedAt: string;
  deliveryMethod: string;
  courierCode: string | null;
  couponCode: string | null;
  items: { id: string; sku: string; name: string; qty: number; unitPrice: string; fitmentStatus: string | null }[];
  payments: { id: string; provider: string; reference: string | null; amount: string; status: string; method: string | null }[];
  shipments: { id: string; status: string; trackingNo: string | null; labelUrl: string | null }[];
  authorizationUrl?: string;
  bankTransfer?: { accountName: string; bankName: string; accountNumber: string; reference: string | null; amount: string };
};

export type Me = {
  id: string;
  email: string | null;
  phone: string | null;
  type: string;
  emailVerifiedAt: string | null;
  customer: { id: string; firstName: string; lastName: string; customerType: string } | null;
};

export type Category = { id: string; name: string; slug: string; path: string; parentId: string | null };
