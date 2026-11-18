import Link from 'next/link';
import { naira } from '@/lib/money';
import type { ProductCardData } from '@/lib/types';
import { FitmentBadge } from './ui';

export function ProductCard({ product, fitment }: { product: ProductCardData; fitment?: string | null }) {
  const price = product.skus[0]?.price.amount;
  const qty = product.skus[0]?.availability?.qty ?? 0;
  return (
    <Link href={`/products/${product.slug}`} className="flex flex-col rounded-2xl border border-[#C4A574]/30 bg-white p-4 transition hover:-translate-y-0.5 hover:border-[#F15A24]">
      {product.media?.[0] ? <img src={product.media[0].url} alt={product.media[0].alt ?? ''} className="mb-3 h-36 w-full rounded-xl object-cover" /> : <div className="mb-3 h-24 rounded-xl bg-[#F4F1EC]" />}
      <p className="text-xs uppercase tracking-[0.14em] text-[#163A70]">{product.manufacturer?.name}</p>
      <p className="mt-1 font-medium leading-snug">{product.name}</p>
      {price ? <p className="mt-3 text-lg text-[#F15A24]">{naira(price)}</p> : null}
      <p className="text-sm text-[#0E1B2C]/60">{qty > 0 ? `${qty} in stock` : 'Out of stock'}</p>
      {fitment ? <div className="mt-2"><FitmentBadge status={fitment} /></div> : null}
      {product.store ? <p className="mt-2 text-sm text-[#163A70]">Sold by {product.store.businessName}</p> : null}
    </Link>
  );
}
