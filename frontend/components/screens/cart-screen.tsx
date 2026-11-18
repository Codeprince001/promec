'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rememberCart } from '@/lib/api';
import { naira } from '@/lib/money';
import { useSession } from '@/lib/session';
import { useMounted } from '@/lib/use-mounted';
import type { CartBody } from '@/lib/types';
import { Card, Empty, FitmentBadge, GhostButton, Loading, Notice, Page, PageHead, primaryClass } from '@/components/ui';

export function CartScreen() {
  const mounted = useMounted();
  const token = useSession((state) => state.token);
  const client = useQueryClient();
  const cart = useQuery({
    queryKey: ['cart', token],
    enabled: mounted,
    queryFn: () => rememberCart<CartBody>('/cart'),
  });
  const change = useMutation({
    mutationFn: ({ id, qty }: { id: string; qty: number }) => rememberCart(`/cart/items/${id}`, { method: 'PATCH', body: JSON.stringify({ qty }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['cart'] }),
  });

  const items = mounted ? cart.data?.data.items ?? [] : [];
  return (
    <Page width="3xl">
      <PageHead kicker="Desk" title="Cart" lede="Prices are in naira. Stock is reserved when you check out, not while the part sits here." />
      {!mounted || cart.isLoading ? <Loading label="Opening the cart…" /> : null}
      {cart.isError ? <div className="mt-4"><Notice>{cart.error.message}</Notice></div> : null}
      {mounted && cart.data && items.length === 0 ? <Empty title="The cart is empty" body="Search the catalogue and add a part. A vehicle can be chosen before checkout." href="/search" label="Search parts" /> : null}
      <div className="mt-6 space-y-3">
        {items.map((item) => (
          <Card key={item.id}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <Link href={`/products/${item.slug}`} className="font-medium">{item.name}</Link>
                <p className="text-sm text-[#0E1B2C]/60">{item.sku}</p>
                {item.fitmentStatus ? <div className="mt-2"><FitmentBadge status={item.fitmentStatus} /></div> : null}
              </div>
              <p className="text-[#F15A24]">{naira(item.lineTotal)}</p>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <GhostButton type="button" className="px-4" onClick={() => change.mutate({ id: item.id, qty: Math.max(0, item.qty - 1) })} aria-label="Decrease quantity">−</GhostButton>
              <span className="min-w-6 text-center">{item.qty}</span>
              <GhostButton type="button" className="px-4" onClick={() => change.mutate({ id: item.id, qty: item.qty + 1 })} aria-label="Increase quantity">+</GhostButton>
              <button type="button" className="ml-auto inline-flex min-h-11 items-center text-sm text-[#163A70]" onClick={() => change.mutate({ id: item.id, qty: 0 })}>Remove</button>
            </div>
          </Card>
        ))}
      </div>
      {items.length ? (
        <div className="mt-6 flex flex-col gap-4 rounded-2xl bg-[#0E1B2C] p-5 text-white sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xl">Subtotal {naira(cart.data?.data.subtotal)}</p>
          <Link href="/checkout" className={primaryClass}>Checkout</Link>
        </div>
      ) : null}
    </Page>
  );
}
