'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@/lib/api';
import { useMounted } from '@/lib/use-mounted';
import type { Category } from '@/lib/types';

export default function ListingsPage() {
  const client = useQueryClient();
  const mounted = useMounted();
  const categories = useQuery({ queryKey: ['categories'], enabled: mounted, queryFn: async () => unwrap(await api<{ data: Category[] }>('/categories')) });
  const products = useQuery({ queryKey: ['catalogue-makers'], enabled: mounted, queryFn: async () => unwrap(await api<{ data: { manufacturer: { id: string; name: string } }[] }>('/products?pageSize=100')) });
  const mine = useQuery({ queryKey: ['vendor-products'], queryFn: async () => unwrap(await api<{ data: { id: string; name: string; status: string }[] }>('/vendor/products')) });
  const makers = [...new Map((products.data ?? []).map((item) => [item.manufacturer.id, item.manufacturer])).values()];
  const [form, setForm] = useState({ name: '', manufacturerId: '', categoryId: '', sellingPrice: '', stockQty: '1', partNumber: '' });
  const [message, setMessage] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage('');
    try {
      await api('/vendor/products', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          manufacturerId: form.manufacturerId,
          categoryId: form.categoryId,
          sellingPrice: Number(form.sellingPrice),
          stockQty: Number(form.stockQty),
          partNumbers: form.partNumber ? [{ number: form.partNumber, type: 'AFTERMARKET' }] : [],
          status: 'in_review',
        }),
      });
      setMessage('Listing sent for PROMEC to publish.');
      await client.invalidateQueries({ queryKey: ['vendor-products'] });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Listing failed');
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/sell" className="text-sm text-[#163A70]">Back to store</Link>
      <p className="mt-4 text-xs font-medium uppercase tracking-[0.18em] text-[#F15A24]">Sell</p>
      <h1 className="display mt-1 text-4xl">Listings</h1>
      <p className="mt-2 text-sm">A listing stays in review until PROMEC publishes it. Buyers then see it on your store.</p>
      {message ? <p className="mt-3">{message}</p> : null}
      <form onSubmit={submit} className="mt-4 grid gap-2">
        <input className="control" placeholder="Part name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
        <select className="control" value={form.manufacturerId} onChange={(event) => setForm({ ...form, manufacturerId: event.target.value })} required>
          <option value="">Manufacturer</option>
          {makers.map((maker) => <option key={maker.id} value={maker.id}>{maker.name}</option>)}
        </select>
        <select className="control" value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })} required>
          <option value="">Category</option>
          {(categories.data ?? []).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
        <input className="control" placeholder="Price in naira" value={form.sellingPrice} onChange={(event) => setForm({ ...form, sellingPrice: event.target.value })} required />
        <input className="control" placeholder="Quantity" value={form.stockQty} onChange={(event) => setForm({ ...form, stockQty: event.target.value })} required />
        <input className="control" placeholder="Part number" value={form.partNumber} onChange={(event) => setForm({ ...form, partNumber: event.target.value })} />
        <button className="inline-flex min-h-11 items-center justify-center rounded-full bg-[#F15A24] px-5 text-sm font-medium text-white" type="submit">Submit listing</button>
      </form>
      <div className="mt-6 space-y-2">{(mine.data ?? []).map((item) => <p key={item.id} className="rounded-xl bg-white px-4 py-3">{item.name} · {item.status}</p>)}{mine.isError ? <p>{mine.error.message}</p> : null}</div>
    </main>
  );
}
