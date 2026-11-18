'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { Button, Empty, Field, Notice, Page, PageHead, Select, ghostClass, navyClass, primaryClass } from '@/components/ui';
import { api, unwrap } from '@/lib/api';
import { naira, STATES } from '@/lib/money';

type Quote = { id: string; quoteNo: string; status: string; items: { description: string; qty: number; unitPrice: string | number }[] };

export function BusinessHome() {
  return (
    <Page width="4xl">
      <PageHead kicker="Trade" title="Trade desk" lede="Workshops and fleets buy on a PROMEC account. Credit, a price list, and quotes are available after the account is approved." />
      <div className="mt-6 flex flex-wrap gap-3">
        <Link className={primaryClass} href="/business/onboard">Open an account</Link>
        <Link className={navyClass} href="/business/quick-order">Quick order</Link>
        <Link className={ghostClass} href="/business/quotes">Quotes</Link>
      </div>
      <CreditPanel />
    </Page>
  );
}

export function OnboardScreen() {
  const [form, setForm] = useState({ legalName: '', cacNumber: '', tin: '', industry: '' });
  const [message, setMessage] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await api('/b2b/accounts', { method: 'POST', body: JSON.stringify(form) });
      setMessage('Application sent. Buying on credit starts after PROMEC approves the limit.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Application failed');
    }
  }
  return <Page width="xl"><PageHead kicker="Trade" title="Open a trade account" lede="Buying on credit starts after PROMEC approves the limit." /><form onSubmit={submit} className="mt-6 grid gap-3"><Field placeholder="Legal name" value={form.legalName} onChange={(event) => setForm({ ...form, legalName: event.target.value })} required /><Field placeholder="CAC number" value={form.cacNumber} onChange={(event) => setForm({ ...form, cacNumber: event.target.value })} /><Field placeholder="TIN" value={form.tin} onChange={(event) => setForm({ ...form, tin: event.target.value })} /><Field placeholder="Industry" value={form.industry} onChange={(event) => setForm({ ...form, industry: event.target.value })} /><Button type="submit">Submit</Button></form>{message ? <div className="mt-4"><Notice>{message}</Notice></div> : null}</Page>;
}

export function QuickOrderScreen() {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ slug: string; name: string; skus: { id: string }[] }[]>([]);
  const [searched, setSearched] = useState(false);
  const [message, setMessage] = useState('');
  async function search(event: FormEvent) {
    event.preventDefault();
    const body = await api<{ data: { slug: string; name: string; skus: { id: string }[] }[] }>(`/search?q=${encodeURIComponent(q)}`);
    setHits(unwrap(body));
    setSearched(true);
  }
  async function add(skuId: string) {
    try {
      await api('/cart/items', { method: 'POST', body: JSON.stringify({ skuId, qty: 1 }) });
      setMessage('Added to the cart.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not add the part');
    }
  }
  return <Page width="3xl"><PageHead kicker="Trade" title="Quick order" lede="Find a published part and add the first SKU to the cart." /><form onSubmit={search} className="mt-6 flex flex-col gap-3 sm:flex-row"><Field className="sm:flex-1" value={q} onChange={(event) => setQ(event.target.value)} placeholder="SKU, name, or part number" /><button className={navyClass} type="submit">Find</button></form>{message ? <div className="mt-4"><Notice>{message}</Notice></div> : null}<div className="mt-4 space-y-2">{hits.map((hit) => <div key={hit.slug} className="flex min-h-11 items-center justify-between gap-3 rounded-2xl bg-white p-4"><span>{hit.name}</span><button className="inline-flex min-h-11 items-center text-sm text-[#F15A24]" type="button" onClick={() => hit.skus[0] && void add(hit.skus[0].id)}>Add</button></div>)}{searched && hits.length === 0 ? <Empty title="Nothing matched" body="No published part used that name or number." /> : null}</div></Page>;
}

export function QuotesScreen() {
  const [description, setDescription] = useState('');
  const [qty, setQty] = useState(1);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [message, setMessage] = useState('');
  async function create(event: FormEvent) {
    event.preventDefault();
    try {
      const body = await api<{ data: Quote }>('/b2b/quotes', { method: 'POST', body: JSON.stringify({ items: [{ description, qty, unitPrice: 0 }] }) });
      setQuotes((current) => [unwrap(body), ...current]);
      setDescription('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Quote failed');
    }
  }
  async function submit(id: string) {
    const body = await api<{ data: Quote }>(`/b2b/quotes/${id}/submit`, { method: 'POST' });
    const next = unwrap(body);
    setQuotes((current) => current.map((quote) => quote.id === id ? next : quote));
  }
  return (
    <Page width="3xl">
      <PageHead kicker="Trade" title="Quotes" lede="A quote starts as a draft. PROMEC approves it before it can become an order. This page keeps the quotes you create in this browser." />
      <form onSubmit={create} className="mt-6 grid gap-3"><Field placeholder="Part description" value={description} onChange={(event) => setDescription(event.target.value)} required /><Field type="number" min={1} value={qty} onChange={(event) => setQty(Number(event.target.value))} /><Button type="submit">Create draft</Button></form>
      {message ? <div className="mt-4"><Notice>{message}</Notice></div> : null}
      <div className="mt-4 space-y-3">{quotes.map((quote) => <article key={quote.id} className="rounded-2xl bg-white p-4"><p className="font-medium">{quote.quoteNo} · {quote.status}</p>{quote.status === 'draft' ? <button className="mt-2 inline-flex min-h-11 items-center text-sm text-[#163A70]" type="button" onClick={() => void submit(quote.id)}>Submit for review</button> : null}{quote.status === 'approved' ? <Link className="mt-2 inline-flex min-h-11 items-center text-sm text-[#F15A24]" href={`/business/quotes/${quote.id}`}>Turn into an order</Link> : null}</article>)}{quotes.length === 0 ? <Empty title="No quotes in this browser" body="Create a draft and PROMEC prices it. Older quotes are not listed by the customer API." /> : null}</div>
    </Page>
  );
}

export function QuoteOrderScreen({ id }: { id: string }) {
  const [form, setForm] = useState({ recipient: '', phone: '', state: 'Lagos', city: '', street: '' });
  const [payment, setPayment] = useState<'account_credit' | 'paystack' | 'bank_transfer'>('account_credit');
  const [message, setMessage] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const body = await api<{ data: { orderNo: string } }>(`/b2b/quotes/${id}/order`, { method: 'POST', body: JSON.stringify({ address: form, paymentMethod: payment, courier: 'gig' }) });
      setMessage(`Order ${unwrap(body).orderNo} placed.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The quote could not be ordered');
    }
  }
  return <Page width="xl"><PageHead kicker="Trade" title="Order this quote" lede="The quote must be approved, unexpired, and every line needs a catalogue SKU." /><form onSubmit={submit} className="mt-6 grid gap-3"><Field placeholder="Recipient" value={form.recipient} onChange={(event) => setForm({ ...form, recipient: event.target.value })} /><Field placeholder="Phone" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /><Select value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value })}>{STATES.map((state) => <option key={state}>{state}</option>)}</Select><Field placeholder="City" value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} /><Field placeholder="Street" value={form.street} onChange={(event) => setForm({ ...form, street: event.target.value })} /><Select value={payment} onChange={(event) => setPayment(event.target.value as typeof payment)}><option value="account_credit">Trade credit</option><option value="paystack">Paystack</option><option value="bank_transfer">Bank transfer</option></Select><Button type="submit">Place order</Button></form>{message ? <div className="mt-4"><Notice>{message}</Notice></div> : null}</Page>;
}

export function ClosedDesk({ title, body }: { title: string; body: string }) {
  return <Page width="3xl"><PageHead kicker="Trade" title={title} lede={body} /><Link className={`${primaryClass} mt-6`} href="/business">Back to the trade desk</Link></Page>;
}

function CreditPanel() {
  const [text, setText] = useState('Checking trade credit…');
  useEffect(() => {
    api<{ data: { status?: string; available?: string; limit?: string } }>('/b2b/credit').then((body) => {
      const credit = unwrap(body);
      setText(`Account ${credit.status ?? 'open'}${credit.available ? ` · available ${naira(credit.available)}` : ''}`);
    }).catch(() => setText('Trade credit appears after PROMEC approves the account.'));
  }, []);
  return <p className="mt-6 rounded-2xl border border-[#C4A574]/40 bg-white p-4 text-sm">{text}</p>;
}
