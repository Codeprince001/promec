import Link from 'next/link';
import { naira } from '@/lib/money';
import type { ProductCardData } from '@/lib/types';
import { FitmentBadge } from './ui';

export function ProductCard({ product, fitment }: { product: ProductCardData; fitment?: string | null }) {
  const price = product.skus[0]?.price.amount;
  const qty = product.skus[0]?.availability?.qty ?? 0;
  return (
    <Link href={`/products/${product.slug}`} className="flex flex-col rounded-2xl border border-gold/30 bg-card p-4 transition hover:-translate-y-0.5 hover:border-brand">
      {product.media?.[0] ? <img src={product.media[0].url} alt={product.media[0].alt ?? ''} className="mb-3 h-36 w-full rounded-xl object-cover" /> : <div className="mb-3 h-24 rounded-xl bg-paper" />}
      <p className="text-xs uppercase tracking-[0.14em] text-link">{product.manufacturer?.name}</p>
      <p className="mt-1 font-medium leading-snug">{product.name}</p>
      {price ? <p className="mt-3 text-lg text-accent">{naira(price)}</p> : null}
      <p className="text-sm text-ink/60">{qty > 0 ? `${qty} in stock` : 'Out of stock'}</p>
      {fitment ? <div className="mt-2"><FitmentBadge status={fitment} /></div> : null}
      {product.store ? <p className="mt-2 text-sm text-link">Sold by {product.store.businessName}</p> : null}
    </Link>
  );
}
