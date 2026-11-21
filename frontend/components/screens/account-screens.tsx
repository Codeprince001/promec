'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { VehicleFinder } from '@/components/finder';
import { api, unwrap } from '@/lib/api';
import { useDesk } from '@/lib/desk';
import { naira, STATES } from '@/lib/money';
import { clearToken, useSession } from '@/lib/session';
import type { Me, OrderBody } from '@/lib/types';

function useMe() {
  const token = useSession((state) => state.token);
  return useQuery({
    queryKey: ['me', token],
    enabled: Boolean(token),
    queryFn: async () => unwrap(await api<{ data: Me }>('/auth/me')),
  });
}

export function AccountHome() {
  const me = useMe();
  const orders = useQuery({
    queryKey: ['orders'],
    enabled: Boolean(me.data),
    queryFn: async () => unwrap(await api<{ data: OrderBody[] }>('/orders')),
  });
  if (!useSession.getState().token && !me.isLoading) return <SignInPrompt />;
  const person = me.data?.customer;
  return (
    <AccountFrame>
      <h1 className="display text-4xl">{person ? `${person.firstName} ${person.lastName}` : 'Account'}</h1>
      <p className="mt-2 text-sm text-ink/70">{me.data?.email} · {person?.customerType?.replace('_', ' ')}</p>
      {!me.data?.emailVerifiedAt ? <button className="mt-3 text-sm text-accent" type="button" onClick={() => api('/auth/email/send', { method: 'POST' })}>Send verification email</button> : null}
      <div className="mt-6 grid gap-3">
        {(orders.data ?? []).slice(0, 3).map((order) => <OrderRow key={order.id} order={order} />)}
      </div>
    </AccountFrame>
  );
}

export function OrdersScreen() {
  const orders = useQuery({ queryKey: ['orders'], queryFn: async () => unwrap(await api<{ data: OrderBody[] }>('/orders')) });
  return <AccountFrame><h1 className="display text-4xl">Orders</h1><div className="mt-4 grid gap-3">{orders.isError ? <p>{orders.error.message}</p> : null}{(orders.data ?? []).map((order) => <OrderRow key={order.id} order={order} />)}{orders.data?.length === 0 ? <p>No orders yet.</p> : null}</div></AccountFrame>;
}

export function OrderScreen({ id }: { id: string }) {
  const client = useQueryClient();
  const [message, setMessage] = useState('');
  const [reason, setReason] = useState('changed_mind');
  const [notes, setNotes] = useState('');
  const order = useQuery({ queryKey: ['order', id], queryFn: async () => unwrap(await api<{ data: OrderBody }>(`/orders/${id}`)) });
  async function act(path: string, body?: unknown) {
    setMessage('');
    try {
      await api(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
      setMessage('Updated.');
      await client.invalidateQueries({ queryKey: ['order', id] });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Request failed');
    }
  }
  const item = order.data;
  if (!item) return <AccountFrame><p>{order.isError ? order.error.message : 'Loading order…'}</p></AccountFrame>;
  const pending = item.payments.find((payment) => payment.status === 'pending' && payment.method === 'bank_transfer');
  return (
    <AccountFrame>
      <h1 className="display text-4xl">{item.orderNo}</h1>
      <p className="mt-2">{item.status} · {item.paymentStatus} · {naira(item.grandTotal)}</p>
      {message ? <p className="mt-3">{message}</p> : null}
      <div className="mt-4 space-y-2">{item.items.map((line) => <p key={line.id}>{line.qty} × {line.name} · {naira(line.unitPrice)}</p>)}</div>
      <div className="mt-4 space-y-2">{item.shipments.map((shipment) => <p key={shipment.id}>Shipment {shipment.status}{shipment.trackingNo ? ` · ${shipment.trackingNo}` : ''} {shipment.trackingNo ? <Link href={`/track?no=${shipment.trackingNo}`}>Track</Link> : null}</p>)}</div>
      {item.status === 'pending_payment' || item.status === 'payment_failed' ? <button className="mt-4 inline-flex min-h-11 items-center rounded-full border border-link px-5 text-sm text-link" type="button" onClick={() => act(`/orders/${id}/cancel`)}>Cancel order</button> : null}
      {item.status === 'delivered' ? (
        <form className="mt-4 grid gap-2" onSubmit={(event) => { event.preventDefault(); void act(`/orders/${id}/returns`, { reasonCode: reason, notes }); }}>
          <input className="control" value={reason} onChange={(event) => setReason(event.target.value)} />
          <textarea className="control" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="What should PROMEC know?" />
          <button className="inline-flex min-h-11 items-center justify-center rounded-full bg-brand px-5 text-sm font-medium text-white" type="submit">Request a return</button>
        </form>
      ) : null}
      {pending?.reference ? <ProofForm reference={pending.reference} amount={pending.amount} /> : null}
    </AccountFrame>
  );
}

function ProofForm({ reference, amount }: { reference: string; amount: string }) {
  const [bankReference, setBankReference] = useState('');
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [message, setMessage] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await api(`/payments/${reference}/proof`, { method: 'POST', body: JSON.stringify({ amount: Number(amount), bankReference, evidenceUrl }) });
      setMessage('Proof sent for matching.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Proof failed');
    }
  }
  return <form onSubmit={submit} className="mt-4 grid gap-2 rounded-2xl bg-card p-4"><p className="font-medium">Bank transfer {naira(amount)}</p><input className="control" placeholder="Bank reference" value={bankReference} onChange={(event) => setBankReference(event.target.value)} /><input className="control" placeholder="https receipt link" value={evidenceUrl} onChange={(event) => setEvidenceUrl(event.target.value)} /><button className="inline-flex min-h-11 items-center justify-center rounded-full bg-navy px-5 text-sm font-medium text-white" type="submit">Send proof</button>{message ? <p>{message}</p> : null}</form>;
}

export function WishlistScreen() {
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ['wishlist'],
    queryFn: async () => unwrap(await api<{ data: { skuId: string; sku: { sku: string; sellingPrice: string; product: { name: string; slug: string } } }[] }>('/wishlist')),
  });
  const remove = useMutation({
    mutationFn: (skuId: string) => api(`/wishlist/${skuId}`, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['wishlist'] }),
  });
  return <AccountFrame><h1 className="display text-4xl">Wishlist</h1><div className="mt-4 space-y-3">{(list.data ?? []).map((item) => <div key={item.skuId} className="flex justify-between rounded-2xl bg-card p-4"><Link href={`/products/${item.sku.product.slug}`}>{item.sku.product.name}</Link><button type="button" onClick={() => remove.mutate(item.skuId)}>Remove</button></div>)}{list.data?.length === 0 ? <p>Nothing saved yet.</p> : null}</div></AccountFrame>;
}

export function GarageScreen() {
  const vehicle = useDesk((state) => state.vehicle);
  const client = useQueryClient();
  const [message, setMessage] = useState('');
  const garage = useQuery({ queryKey: ['garage'], queryFn: async () => unwrap(await api<{ data: { id: string; nickname: string | null; year: number | null; hasVin: boolean; variant?: { model?: { name: string; make?: { name: string } } } }[] }>('/garage')) });
  async function save() {
    if (!vehicle) return setMessage('Select a vehicle first.');
    try {
      await api('/garage', { method: 'POST', body: JSON.stringify({ vehicleVariantId: vehicle.variantId, year: vehicle.year, isDefault: true }) });
      setMessage('Saved to your garage.');
      await client.invalidateQueries({ queryKey: ['garage'] });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save the vehicle');
    }
  }
  return (
    <AccountFrame>
      <h1 className="display text-4xl">Garage</h1>
      <div className="mt-4"><VehicleFinder /></div>
      <button className="mt-3 rounded-full bg-brand px-4 py-2 text-white" type="button" onClick={() => void save()}>Save the selected vehicle</button>
      {message ? <p className="mt-2">{message}</p> : null}
      <div className="mt-4 space-y-2">{(garage.data ?? []).map((item) => <div key={item.id} className="flex justify-between rounded-2xl bg-card p-4"><span>{item.year} {item.variant?.model?.make?.name} {item.variant?.model?.name}{item.hasVin ? ' · VIN stored' : ''}</span><button type="button" onClick={() => api(`/garage/${item.id}`, { method: 'DELETE' }).then(() => client.invalidateQueries({ queryKey: ['garage'] }))}>Remove</button></div>)}</div>
    </AccountFrame>
  );
}

export function AddressesScreen() {
  const client = useQueryClient();
  const [form, setForm] = useState({ recipient: '', phone: '', state: 'Lagos', city: '', street: '' });
  const [message, setMessage] = useState('');
  const list = useQuery({ queryKey: ['addresses'], queryFn: async () => unwrap(await api<{ data: { id: string; recipient: string; street: string; city: string; state: string }[] }>('/me/addresses')) });
  async function add(event: FormEvent) {
    event.preventDefault();
    try {
      await api('/me/addresses', { method: 'POST', body: JSON.stringify({ ...form, isDefaultShipping: true }) });
      setMessage('Address saved.');
      await client.invalidateQueries({ queryKey: ['addresses'] });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save the address');
    }
  }
  return (
    <AccountFrame>
      <h1 className="display text-4xl">Addresses</h1>
      <form onSubmit={add} className="mt-4 grid gap-2 sm:grid-cols-2">
        <input className="control" placeholder="Recipient" value={form.recipient} onChange={(event) => setForm({ ...form, recipient: event.target.value })} />
        <input className="control" placeholder="Phone" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
        <select className="control" value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value })}>{STATES.map((state) => <option key={state}>{state}</option>)}</select>
        <input className="control" placeholder="City" value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} />
        <input className="rounded-xl border px-3 py-2 sm:col-span-2" placeholder="Street" value={form.street} onChange={(event) => setForm({ ...form, street: event.target.value })} />
        <button className="inline-flex min-h-11 items-center justify-center rounded-full bg-brand px-5 text-sm font-medium text-white" type="submit">Save address</button>
      </form>
      {message ? <p className="mt-2">{message}</p> : null}
      <div className="mt-4 space-y-2">{(list.data ?? []).map((address) => <div key={address.id} className="flex justify-between rounded-2xl bg-card p-4"><span>{address.recipient}, {address.street}, {address.city}, {address.state}</span><button type="button" onClick={() => api(`/me/addresses/${address.id}`, { method: 'DELETE' }).then(() => client.invalidateQueries({ queryKey: ['addresses'] }))}>Delete</button></div>)}</div>
    </AccountFrame>
  );
}

export function PaymentsScreen() {
  const orders = useQuery({ queryKey: ['orders'], queryFn: async () => unwrap(await api<{ data: OrderBody[] }>('/orders')) });
  const pending = (orders.data ?? []).filter((order) => order.paymentStatus === 'pending');
  return <AccountFrame><h1 className="display text-4xl">Payments</h1><p className="mt-2 text-sm text-ink/70">Card payments go through Paystack. A bank transfer stays pending until PROMEC matches your proof. Trade credit is available on an approved business account.</p><div className="mt-4 space-y-3">{pending.map((order) => <OrderRow key={order.id} order={order} />)}{pending.length === 0 ? <p>No payments are waiting.</p> : null}</div></AccountFrame>;
}

export function ReturnsScreen() {
  const orders = useQuery({ queryKey: ['orders'], queryFn: async () => unwrap(await api<{ data: OrderBody[] }>('/orders')) });
  const delivered = (orders.data ?? []).filter((order) => order.status === 'delivered' || order.status === 'return_requested' || order.status === 'returned');
  return <AccountFrame><h1 className="display text-4xl">Returns</h1><p className="mt-2 text-sm">A return opens after delivery. PROMEC inspects the part before a refund.</p><div className="mt-4 space-y-3">{delivered.map((order) => <OrderRow key={order.id} order={order} />)}{delivered.length === 0 ? <p>No delivered orders to return.</p> : null}</div></AccountFrame>;
}

export function PartRequestsScreen() {
  const list = useQuery({ queryKey: ['part-requests'], queryFn: async () => unwrap(await api<{ data: { id: string; description: string; status: string; quotedPrice: string | null; quoteNote: string | null }[] }>('/part-requests')) });
  return <AccountFrame><h1 className="display text-4xl">Part requests</h1><Link className="text-accent" href="/request-a-part">New request</Link><div className="mt-4 space-y-3">{(list.data ?? []).map((item) => <article key={item.id} className="rounded-2xl bg-card p-4"><p>{item.description}</p><p className="text-sm">{item.status}{item.quotedPrice ? ` · ${naira(item.quotedPrice)}` : ''}</p>{item.quoteNote ? <p className="text-sm">{item.quoteNote}</p> : null}</article>)}</div></AccountFrame>;
}

export function SupportScreen() {
  const client = useQueryClient();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [reply, setReply] = useState('');
  const tickets = useQuery({ queryKey: ['tickets'], queryFn: async () => unwrap(await api<{ data: { id: string; ticketNo: string; subject: string; status: string; messages: { id: string; body: string; isStaff: boolean }[] }[] }>('/support/tickets')) });
  async function create(event: FormEvent) {
    event.preventDefault();
    await api('/support/tickets', { method: 'POST', body: JSON.stringify({ subject, body, category: 'order' }) });
    setSubject('');
    setBody('');
    await client.invalidateQueries({ queryKey: ['tickets'] });
  }
  return (
    <AccountFrame>
      <h1 className="display text-4xl">Support</h1>
      <form onSubmit={create} className="mt-4 grid gap-2"><input className="control" placeholder="Subject" value={subject} onChange={(event) => setSubject(event.target.value)} /><textarea className="control" placeholder="How can PROMEC help?" value={body} onChange={(event) => setBody(event.target.value)} /><button className="inline-flex min-h-11 items-center justify-center rounded-full bg-brand px-5 text-sm font-medium text-white" type="submit">Open ticket</button></form>
      <div className="mt-4 space-y-4">{(tickets.data ?? []).map((ticket) => <article key={ticket.id} className="rounded-2xl bg-card p-4"><p className="font-medium">{ticket.ticketNo} · {ticket.subject}</p>{ticket.messages.map((message) => <p key={message.id} className="mt-2 text-sm">{message.isStaff ? 'PROMEC: ' : 'You: '}{message.body}</p>)}<form className="mt-2 flex gap-2" onSubmit={(event) => { event.preventDefault(); void api(`/support/tickets/${ticket.id}/messages`, { method: 'POST', body: JSON.stringify({ body: reply }) }).then(() => client.invalidateQueries({ queryKey: ['tickets'] })); }}><input className="flex-1 rounded-xl border px-3 py-2" value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Reply" /><button type="submit">Send</button></form></article>)}</div>
    </AccountFrame>
  );
}

export function SettingsScreen() {
  const me = useMe();
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: async () => unwrap(await api<{ data: { id: string; ip: string | null; userAgent: string | null; createdAt: string }[] }>('/auth/sessions')) });
  const client = useQueryClient();
  return (
    <AccountFrame>
      <h1 className="display text-4xl">Settings</h1>
      <p className="mt-2">{me.data?.email} · {me.data?.type}</p>
      <Link className="mt-2 inline-block text-link" href="/forgot-password">Change password</Link>
      <h2 className="mt-6 font-semibold">Sessions</h2>
      <div className="mt-2 space-y-2">{(sessions.data ?? []).map((session) => <div key={session.id} className="flex justify-between rounded-xl bg-card p-3 text-sm"><span>{session.ip ?? 'Unknown IP'} · {session.userAgent ?? 'Unknown device'}</span><button type="button" onClick={() => api(`/auth/sessions/${session.id}`, { method: 'DELETE' }).then(() => client.invalidateQueries({ queryKey: ['sessions'] }))}>Revoke</button></div>)}</div>
      <button className="mt-6 text-sm text-accent" type="button" onClick={() => { clearToken(); window.location.href = '/'; }}>Sign out</button>
    </AccountFrame>
  );
}

function OrderRow({ order }: { order: OrderBody }) {
  return (
    <Link href={`/account/orders/${order.id}`} className="flex min-h-11 items-center justify-between gap-3 rounded-2xl border border-gold/30 bg-card p-4">
      <span>{order.orderNo}<br /><span className="text-sm text-ink/60">{order.status.replaceAll('_', ' ')}</span></span>
      <span className="text-accent">{naira(order.grandTotal)}</span>
    </Link>
  );
}

const accountLinks = [['Overview', '/account'], ['Orders', '/account/orders'], ['Wishlist', '/account/wishlist'], ['Garage', '/account/garage'], ['Addresses', '/account/addresses'], ['Payments', '/account/payments'], ['Returns', '/account/returns'], ['Part requests', '/account/part-requests'], ['Support', '/account/support'], ['Settings', '/account/settings']];

export function AccountFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto grid max-w-6xl gap-6 px-4 py-8 md:grid-cols-[220px_1fr] md:py-10">
      <nav className="flex gap-2 overflow-x-auto pb-1 md:grid md:content-start md:overflow-visible">
        {accountLinks.map(([label, href]) => <Link key={href} href={href} className="inline-flex min-h-11 shrink-0 items-center rounded-full px-3 text-sm text-link hover:bg-card">{label}</Link>)}
      </nav>
      <div>{children}</div>
    </main>
  );
}

function SignInPrompt() {
  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <div className="rounded-2xl border border-dashed border-gold bg-card px-5 py-8">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">Account</p>
        <h1 className="display mt-1 text-4xl">Sign in to open the desk.</h1>
        <p className="mt-3 text-sm text-ink/75">Orders, garage, addresses, and support sit with your account.</p>
        <Link href="/login?next=/account" className="mt-5 inline-flex min-h-11 items-center rounded-full bg-brand px-5 text-sm font-medium text-white">Sign in</Link>
      </div>
    </main>
  );
}
