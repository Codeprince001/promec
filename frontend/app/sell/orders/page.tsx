'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@/lib/api';
import { naira } from '@/lib/money';

type VendorOrder = { id: string; orderNo: string; status: string; grandTotal: string };

export default function VendorOrdersPage() {
  const client = useQueryClient();
  const [tracking, setTracking] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const orders = useQuery({ queryKey: ['vendor-orders'], queryFn: async () => unwrap(await api<{ data: VendorOrder[] }>('/vendor/orders')) });

  async function ship(event: FormEvent, id: string) {
    event.preventDefault();
    try {
      await api(`/vendor/orders/${id}/ship`, { method: 'POST', body: JSON.stringify({ trackingNo: tracking[id] }) });
      setMessage('Shipment recorded.');
      await client.invalidateQueries({ queryKey: ['vendor-orders'] });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not ship');
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/sell" className="text-sm text-link">Back to store</Link>
      <p className="mt-4 text-xs font-medium uppercase tracking-[0.18em] text-accent">Sell</p>
      <h1 className="display mt-1 text-4xl">Store orders</h1>
      {message ? <p className="mt-3">{message}</p> : null}
      <div className="mt-4 space-y-3">
        {(orders.data ?? []).map((order) => (
          <article key={order.id} className="rounded-2xl bg-card p-4">
            <p className="font-medium">{order.orderNo} · {order.status} · {naira(order.grandTotal)}</p>
            <form className="mt-2 flex gap-2" onSubmit={(event) => void ship(event, order.id)}>
              <input className="control flex-1" placeholder="Tracking number" value={tracking[order.id] ?? ''} onChange={(event) => setTracking({ ...tracking, [order.id]: event.target.value })} />
              <button className="inline-flex min-h-11 items-center justify-center rounded-full bg-navy px-5 text-sm font-medium text-white" type="submit">Ship</button>
            </form>
          </article>
        ))}
        {orders.isError ? <p>{orders.error.message}</p> : null}
        {orders.data?.length === 0 ? <p className="rounded-2xl border border-dashed border-gold bg-card px-5 py-8 text-sm text-ink/75">No store orders yet. They appear after a buyer pays for one of your published parts.</p> : null}
      </div>
    </main>
  );
}
