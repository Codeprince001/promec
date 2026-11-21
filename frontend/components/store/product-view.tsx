'use client';

import { useEffect, useState } from 'react';
import { SiteHeader } from '../brand/site-header';
import { api } from '../../lib/api';
import { naira } from '../../lib/money';
import type { StoreProduct } from './types';

export function ProductView({ slug }: { slug: string }) {
  const [product, setProduct] = useState<StoreProduct & { description?: string | null } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ data: StoreProduct & { description?: string | null } }>(`/products/${slug}`)
      .then((result) => setProduct(result.data))
      .catch((reason: Error) => setError(reason.message));
  }, [slug]);

  const price = product?.skus[0]?.price.amount;

  return (
    <div className="min-h-screen bg-paper text-ink">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-10">
        {error ? <p>{error}</p> : null}
        {!product && !error ? <p>Loading part…</p> : null}
        {product ? (
          <article className="rounded-3xl bg-card p-6">
            {product.media[0] ? <img src={product.media[0].url} alt={product.media[0].alt ?? ''} className="mb-5 h-72 w-full rounded-2xl object-cover" /> : null}
            <h1 className="text-3xl font-semibold">{product.name}</h1>
            {price ? <p className="mt-3 text-2xl text-accent">{naira(price)}</p> : null}
            {product.description ? <p className="mt-4 leading-7">{product.description}</p> : null}
            {product.store ? (
              <a href={`/stores/${product.store.slug}`} className="mt-6 flex items-center justify-between rounded-2xl bg-navy px-4 py-4 text-white">
                <span>
                  <span className="block text-sm text-white/70">Sold by</span>
                  <span className="text-lg font-semibold">{product.store.businessName}</span>
                </span>
                <span className="text-sm">{product.store.ratingCount > 0 ? `${product.store.ratingAvg} · ${product.store.ratingCount}` : 'Visit store'}</span>
              </a>
            ) : (
              <p className="mt-6 text-sm text-ink/70">Sold by PROMEC</p>
            )}
          </article>
        ) : null}
      </main>
    </div>
  );
}
