'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { shipsFrom, type StoreCard } from '../../components/store/types';

export default function StoreList() {
  const [stores, setStores] = useState<StoreCard[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ data: StoreCard[] }>('/vendors')
      .then((result) => setStores(result.data))
      .catch((reason: Error) => setError(reason.message));
  }, []);

  return (
    <div>
      <main className="mx-auto max-w-6xl px-4 py-10">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-[#F15A24]">Marketplace</p>
        <h1 className="display mt-1 text-4xl leading-[0.95] sm:text-5xl">Stores</h1>
        <p className="mt-3 max-w-2xl text-[#0E1B2C]/75">Approved sellers list parts on PROMEC. Open a store to see what they stock, where they are, and how buyers rate them.</p>
        {error ? <p className="mt-8">{error}</p> : null}
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {stores.map((store) => (
            <a key={store.slug} href={`/stores/${store.slug}`} className="rounded-2xl bg-white p-5 shadow-sm">
              <p className="text-xl font-semibold">{store.businessName}</p>
              <p className="mt-1 text-sm text-[#0E1B2C]/70">
                {store.ratingCount > 0 ? `${store.ratingAvg} · ${store.ratingCount} ratings` : 'No ratings yet'}
                {' · '}
                {shipsFrom(store.fulfilmentMode)}
              </p>
              <p className="mt-3 line-clamp-3 text-sm">{store.description || 'No description yet.'}</p>
            </a>
          ))}
        </div>
        {!error && stores.length === 0 ? <p className="mt-8 text-[#0E1B2C]/70">No approved stores yet.</p> : null}
      </main>
    </div>
  );
}
