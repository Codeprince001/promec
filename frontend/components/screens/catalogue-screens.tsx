'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { ProductCard } from '@/components/product-card';
import { VehicleFinder } from '@/components/finder';
import { Area, Button, Empty, Field, Loading, Notice, Page, PageHead, ProductGrid } from '@/components/ui';
import { api, unwrap } from '@/lib/api';
import { slugifyName } from '@/lib/money';
import { useDesk } from '@/lib/desk';
import { useMounted } from '@/lib/use-mounted';
import type { Category, ProductCardData } from '@/lib/types';

export function CategoryScreen({ slug }: { slug: string }) {
  const mounted = useMounted();
  const products = useQuery({
    queryKey: ['category', slug],
    enabled: mounted,
    queryFn: async () => unwrap(await api<{ data: ProductCardData[] }>(`/products?category=${slug}&pageSize=48`)),
  });
  const title = slug.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  return (
    <Page>
      <PageHead kicker="Category" title={title} lede="Published parts in this group. Fitment is checked on the part page after you choose a vehicle." />
      {!mounted || products.isLoading ? <Loading label="Loading parts…" /> : null}
      {products.isError ? <div className="mt-4"><Notice>{products.error.message}</Notice></div> : null}
      <ProductGrid>{(products.data ?? []).map((product) => <ProductCard key={product.slug} product={product} />)}</ProductGrid>
      {products.data?.length === 0 ? <Empty title="Nothing published here" body="This category has no parts on the desk yet." href="/categories" label="All categories" /> : null}
    </Page>
  );
}

export function CategoriesScreen() {
  const mounted = useMounted();
  const categories = useQuery({
    queryKey: ['categories'],
    enabled: mounted,
    queryFn: async () => unwrap(await api<{ data: Category[] }>('/categories')),
  });
  return (
    <Page>
      <PageHead kicker="Catalogue" title="Categories" lede="Start with the part group, then the vehicle." />
      {!mounted || categories.isLoading ? <Loading label="Loading categories…" /> : null}
      {categories.isError ? <div className="mt-4"><Notice>{categories.error.message}</Notice></div> : null}
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(categories.data ?? []).map((category) => (
          <Link key={category.id} className="rounded-2xl border border-gold/30 bg-card px-5 py-6 transition hover:border-brand" href={`/categories/${category.slug}`}>
            <p className="text-xs uppercase tracking-[0.16em] text-accent">Shop</p>
            <p className="display mt-2 text-3xl text-link">{category.name}</p>
          </Link>
        ))}
      </div>
      {categories.data?.length === 0 ? <Empty title="No categories yet" body="Groups appear when PROMEC publishes the catalogue." /> : null}
    </Page>
  );
}

export function BrandsScreen() {
  const mounted = useMounted();
  const products = useQuery({
    queryKey: ['brand-source'],
    enabled: mounted,
    queryFn: async () => unwrap(await api<{ data: ProductCardData[] }>('/products?pageSize=100')),
  });
  const names = [...new Set((products.data ?? []).map((product) => product.manufacturer?.name).filter(Boolean) as string[])].sort();
  return (
    <Page>
      <PageHead kicker="Catalogue" title="Brands" lede="These are the manufacturers already published. There is no separate brands list." />
      {!mounted || products.isLoading ? <Loading label="Reading the catalogue…" /> : null}
      {products.isError ? <div className="mt-4"><Notice>{products.error.message}</Notice></div> : null}
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {names.map((name) => (
          <Link key={name} className="rounded-2xl border border-gold/30 bg-card px-5 py-6 transition hover:border-brand" href={`/brands/${slugifyName(name)}`}>
            <p className="display text-3xl text-link">{name}</p>
          </Link>
        ))}
      </div>
      {mounted && products.data && names.length === 0 ? <Empty title="No published brands" body="A brand appears here after one of its parts is published." /> : null}
    </Page>
  );
}

export function BrandScreen({ slug }: { slug: string }) {
  const mounted = useMounted();
  const products = useQuery({
    queryKey: ['brand', slug],
    enabled: mounted,
    queryFn: async () => unwrap(await api<{ data: ProductCardData[] }>('/products?pageSize=100')),
  });
  const rows = (products.data ?? []).filter((product) => slugifyName(product.manufacturer?.name ?? '') === slug);
  return (
    <Page>
      <PageHead kicker="Brand" title={slug.replace(/-/g, ' ')} lede="Parts from this manufacturer in the published catalogue." />
      {!mounted || products.isLoading ? <Loading label="Loading parts…" /> : null}
      <ProductGrid>{rows.map((product) => <ProductCard key={product.slug} product={product} />)}</ProductGrid>
      {mounted && products.data && rows.length === 0 ? <Empty title="No parts for this brand" body="Nothing published matches this name." href="/brands" label="All brands" /> : null}
    </Page>
  );
}

export function VehiclesScreen() {
  return (
    <Page width="3xl">
      <PageHead kicker="Fitment" title="Shop by vehicle" lede="Make, model, year, then engine. A VIN is used only when it matches a catalogue variant." />
      <div className="mt-6"><VehicleFinder /></div>
    </Page>
  );
}

export function RequestScreen() {
  const params = useSearchParams();
  const vehicle = useDesk((state) => state.vehicle);
  const [description, setDescription] = useState(params.get('q') ?? '');
  const [partNumber, setPartNumber] = useState(params.get('q') ?? '');
  const [email, setEmail] = useState('');
  const [vin, setVin] = useState('');
  const [message, setMessage] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await api('/part-requests', { method: 'POST', body: JSON.stringify({ description, partNumber: partNumber || undefined, vehicleVariantId: vehicle?.variantId, vin: vin || undefined, contactEmail: email || undefined }) });
      setMessage('Request received. PROMEC replies with a quote.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Request failed');
    }
  }
  return (
    <Page width="xl">
      <PageHead kicker="Desk" title="Request a part" lede={vehicle ? `Vehicle on file: ${vehicle.label}` : 'Send the number, the vehicle, and how to reach you.'} />
      <form onSubmit={submit} className="mt-6 grid gap-3">
        <Area value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What do you need?" required />
        <Field value={partNumber} onChange={(event) => setPartNumber(event.target.value)} placeholder="Part number" />
        <Field value={vin} onChange={(event) => setVin(event.target.value)} placeholder="VIN, if you have it" />
        <Field value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email, if you are not signed in" />
        <Button type="submit">Send request</Button>
      </form>
      {message ? <div className="mt-4"><Notice>{message}</Notice></div> : null}
    </Page>
  );
}

export function TrackScreen() {
  const params = useSearchParams();
  const [no, setNo] = useState(params.get('no') ?? '');
  const [result, setResult] = useState<string>('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const body = await api<unknown>(`/shipping/track/${encodeURIComponent(no)}`);
      setResult(JSON.stringify(unwrap(body as { data: unknown }), null, 2));
    } catch (error) {
      setResult(error instanceof Error ? error.message : 'Tracking failed');
    }
  }
  return (
    <Page width="xl">
      <PageHead kicker="Delivery" title="Track a parcel" lede="Use the waybill GIG, DHL, or the seller gave you. PROMEC does not invent a tracking number." />
      <form onSubmit={submit} className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Field className="sm:flex-1" value={no} onChange={(event) => setNo(event.target.value)} placeholder="Tracking number" />
        <Button type="submit">Track</Button>
      </form>
      {result ? <pre className="mt-4 overflow-auto rounded-2xl bg-card p-4 text-sm">{result}</pre> : null}
    </Page>
  );
}

export function ContactScreen() {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const created = await api<{ data: { ticketNo: string } }>('/support/tickets', { method: 'POST', body: JSON.stringify({ subject, body, email: email || undefined, category: 'general' }) });
      setMessage(`Ticket ${unwrap(created).ticketNo} is open.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Message failed');
    }
  }
  return (
    <Page width="xl">
      <PageHead kicker="Desk" title="Contact" lede="Write to the parts desk. A ticket number comes back when the message is accepted." />
      <form onSubmit={submit} className="mt-6 grid gap-3">
        <Field placeholder="Subject" value={subject} onChange={(event) => setSubject(event.target.value)} required />
        <Area placeholder="Message" value={body} onChange={(event) => setBody(event.target.value)} required />
        <Field placeholder="Email if you are not signed in" value={email} onChange={(event) => setEmail(event.target.value)} />
        <Button type="submit">Send</Button>
      </form>
      {message ? <div className="mt-4"><Notice>{message}</Notice></div> : null}
    </Page>
  );
}
