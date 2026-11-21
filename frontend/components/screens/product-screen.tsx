'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Card, FitmentBadge, GhostButton, Loading, Notice, Page } from '@/components/ui';
import { api, rememberCart, unwrap } from '@/lib/api';
import { track } from '@/lib/analytics';
import { useDesk } from '@/lib/desk';
import { useMounted } from '@/lib/use-mounted';
import { useSession } from '@/lib/session';
import { naira } from '@/lib/money';
import type { CartBody, ProductCardData } from '@/lib/types';

export function ProductScreen({ slug }: { slug: string }) {
  const mounted = useMounted();
  const vehicle = useDesk((state) => state.vehicle);
  const token = useSession((state) => state.token);
  const client = useQueryClient();
  const [message, setMessage] = useState('');
  const product = useQuery({
    queryKey: ['product', slug],
    enabled: mounted,
    queryFn: async () => unwrap(await api<{ data: ProductCardData & { description?: string | null; partNumbers?: { number: string; type: string }[]; warrantyMonths?: number; originCountry?: string | null; condition?: string } }>(`/products/${slug}`)),
  });
  const fitment = useQuery({
    queryKey: ['fitment', product.data?.id, vehicle?.variantId, vehicle?.year],
    enabled: Boolean(product.data?.id && vehicle?.variantId),
    queryFn: async () => {
      const query = new URLSearchParams({ productId: product.data!.id!, vehicleVariantId: vehicle!.variantId });
      if (vehicle?.year) query.set('year', String(vehicle.year));
      return unwrap(await api<{ data: { status: string; notes: string } }>(`/compatibility/check?${query.toString()}`));
    },
  });
  const add = useMutation({
    mutationFn: async () => {
      const skuId = product.data?.skus[0]?.id;
      if (!skuId) throw new Error('This part has no sellable SKU');
      return rememberCart<CartBody>('/cart/items', {
        method: 'POST',
        body: JSON.stringify({ skuId, qty: 1, vehicleVariantId: vehicle?.variantId }),
      });
    },
    onSuccess: async () => {
      setMessage('Added to the cart.');
      track('add_to_cart', { slug });
      await client.invalidateQueries({ queryKey: ['cart'] });
    },
    onError: (error: Error) => setMessage(error.message),
  });
  const save = useMutation({
    mutationFn: async () => {
      const skuId = product.data?.skus[0]?.id;
      if (!skuId) throw new Error('This part has no sellable SKU');
      return api('/wishlist', { method: 'POST', body: JSON.stringify({ skuId }) });
    },
    onSuccess: () => setMessage('Saved to your wishlist.'),
    onError: (error: Error) => setMessage(error.message),
  });

  const item = product.data;
  if (!mounted || product.isLoading) return <Page><Loading label="Loading part…" /></Page>;
  if (product.isError || !item) return <Page><Notice>{product.error?.message ?? 'Part was not found'}</Notice></Page>;
  const price = item.skus[0]?.price.amount;
  const qty = item.skus[0]?.availability?.qty ?? 0;

  return (
    <Page>
    <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
      <article className="rounded-2xl bg-card p-5 sm:p-6">
        {item.media?.[0] ? <img src={item.media[0].url} alt={item.media[0].alt ?? ''} className="mb-5 h-80 w-full rounded-2xl object-cover" /> : null}
        <p className="text-sm uppercase tracking-wide text-link">{item.manufacturer?.name}</p>
        <h1 className="display mt-2 text-4xl leading-[0.95] sm:text-5xl">{item.name}</h1>
        {price ? <p className="mt-3 text-3xl text-accent">{naira(price)}</p> : null}
        <p className="mt-2 text-sm">{qty > 0 ? `${qty} available` : 'Out of stock'}</p>
        {item.description ? <p className="mt-4 leading-7">{item.description}</p> : null}
        {item.partNumbers?.length ? <p className="mt-4 text-sm">Numbers: {item.partNumbers.map((part) => `${part.type} ${part.number}`).join(' · ')}</p> : null}
        <p className="mt-2 text-sm text-ink/70">{item.condition ?? 'new'}{item.warrantyMonths ? ` · ${item.warrantyMonths} month warranty` : ''}{item.originCountry ? ` · origin ${item.originCountry}` : ''}</p>
      </article>
      <aside className="space-y-4">
        <Card>
          {vehicle && fitment.data ? <div className="mb-3"><FitmentBadge status={fitment.data.status} /><p className="mt-2 text-sm">{fitment.data.notes}</p></div> : <p className="mb-3 text-sm text-ink/70">Select a vehicle to see whether this part is recorded as a fit.</p>}
          {message ? <div className="mb-3"><Notice>{message}</Notice></div> : null}
          <Button className="w-full" type="button" disabled={qty < 1 || add.isPending} onClick={() => add.mutate()}>{add.isPending ? 'Adding…' : 'Add to cart'}</Button>
          <GhostButton className="mt-2 w-full" type="button" disabled={!token || save.isPending} onClick={() => save.mutate()}>{token ? 'Save to wishlist' : 'Sign in to save'}</GhostButton>
        </Card>
        {item.store ? (
          <a href={`/stores/${item.store.slug}`} className="block rounded-2xl bg-navy p-5 text-white">
            <p className="text-xs uppercase tracking-[0.16em] text-white/70">Sold by</p>
            <p className="display mt-1 text-3xl">{item.store.businessName}</p>
            <p className="mt-1 text-sm">{item.store.ratingCount ? `${item.store.ratingAvg} · ${item.store.ratingCount} ratings` : 'Visit the store'}</p>
          </a>
        ) : <Card><p className="text-sm">Sold by PROMEC</p></Card>}
      </aside>
    </div>
    </Page>
  );
}
