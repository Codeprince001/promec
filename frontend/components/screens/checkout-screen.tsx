'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Field, Label, Loading, Notice, Page, PageHead, Select } from '@/components/ui';
import { api, rememberCart, unwrap } from '@/lib/api';
import { naira, STATES } from '@/lib/money';
import { useSession } from '@/lib/session';
import { useMounted } from '@/lib/use-mounted';
import type { CartBody, OrderBody } from '@/lib/types';

type Address = { id: string; recipient: string; phone: string; state: string; city: string; street: string; isDefaultShipping: boolean };

export function CheckoutScreen() {
  const mounted = useMounted();
  const router = useRouter();
  const token = useSession((state) => state.token);
  const cart = useQuery({ queryKey: ['cart', token], enabled: mounted, queryFn: () => rememberCart<CartBody>('/cart') });
  const addresses = useQuery({
    queryKey: ['addresses', token],
    enabled: Boolean(token),
    queryFn: async () => unwrap(await api<{ data: Address[] }>('/me/addresses')),
  });
  const [addressId, setAddressId] = useState('');
  const [form, setForm] = useState({ recipient: '', phone: '', state: 'Lagos', city: '', street: '', lga: '', landmark: '' });
  const [email, setEmail] = useState('');
  const [courier, setCourier] = useState<'gig' | 'dhl'>('gig');
  const [delivery, setDelivery] = useState<'courier' | 'pickup'>('courier');
  const [payment, setPayment] = useState<'paystack' | 'bank_transfer' | 'account_credit'>('paystack');
  const [coupon, setCoupon] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const quote = useQuery({
    queryKey: ['ship-quote', form.state, delivery, courier],
    enabled: mounted && (delivery === 'pickup' || form.state.length > 1),
    queryFn: async () => unwrap(await api<{ data: { amount: string; etaDays: number | null; courier: string | null; zone: string } }>('/shipping/quote', {
      method: 'POST',
      body: JSON.stringify({ state: form.state || 'Lagos', weightG: 1000, method: delivery, courier: delivery === 'courier' ? courier : undefined }),
    })),
  });

  async function place(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const body = await api<{ data: OrderBody }>('/checkout', {
        method: 'POST',
        headers: { 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({
          addressId: addressId || undefined,
          address: addressId ? undefined : form,
          contactEmail: email || undefined,
          contactPhone: form.phone || undefined,
          deliveryMethod: delivery,
          courier: delivery === 'courier' ? courier : undefined,
          paymentMethod: payment,
          couponCode: coupon || undefined,
        }),
      });
      const order = unwrap(body);
      sessionStorage.setItem('promec.checkout', JSON.stringify(order));
      if (order.authorizationUrl) {
        window.location.href = order.authorizationUrl;
        return;
      }
      router.push(`/checkout/complete?order=${order.id}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Checkout failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      {!mounted ? <Loading label="Preparing checkout…" /> : null}
      <form onSubmit={place} className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-4">
          <PageHead kicker="Desk" title="Checkout" lede="Pay with Paystack, transfer to the PROMEC account, or use approved trade credit." />
          {message ? <Notice>{message}</Notice> : null}
          {addresses.data?.length ? (
            <Label>Saved address
              <Select value={addressId} onChange={(event) => setAddressId(event.target.value)}>
                <option value="">Use a new address</option>
                {addresses.data.map((address) => <option key={address.id} value={address.id}>{address.recipient}, {address.street}, {address.city}</option>)}
              </Select>
            </Label>
          ) : null}
          {!addressId ? (
            <Card className="grid gap-3 sm:grid-cols-2">
              <Text label="Recipient" value={form.recipient} onChange={(value) => setForm({ ...form, recipient: value })} />
              <Text label="Phone" value={form.phone} onChange={(value) => setForm({ ...form, phone: value })} />
              <Label>State
                <Select value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value })}>
                  {STATES.map((state) => <option key={state}>{state}</option>)}
                </Select>
              </Label>
              <Text label="City" value={form.city} onChange={(value) => setForm({ ...form, city: value })} />
              <Text label="Street" value={form.street} onChange={(value) => setForm({ ...form, street: value })} />
              <Text label="LGA" value={form.lga} onChange={(value) => setForm({ ...form, lga: value })} />
            </Card>
          ) : null}
          <Text label="Email for the receipt" value={email} onChange={setEmail} />
          <Card className="grid gap-3 sm:grid-cols-2">
            <Choice label="Delivery" value={delivery} onChange={(value) => setDelivery(value as 'courier' | 'pickup')} options={[['courier', 'Courier'], ['pickup', 'Lagos pickup']]} />
            <Choice label="Courier" value={courier} onChange={(value) => setCourier(value as 'gig' | 'dhl')} options={[['gig', 'GIG'], ['dhl', 'DHL']]} />
            <Choice label="Payment" value={payment} onChange={(value) => setPayment(value as typeof payment)} options={[['paystack', 'Paystack'], ['bank_transfer', 'Bank transfer'], ['account_credit', 'Trade credit']]} />
            <Text label="Coupon" value={coupon} onChange={setCoupon} />
          </Card>
          <Button disabled={busy} type="submit">{busy ? 'Placing order…' : 'Place order'}</Button>
        </div>
        <Card className="h-fit">
          <h2 className="display text-3xl text-[#163A70]">Order</h2>
          <p className="mt-3">Parts {naira(cart.data?.data.subtotal)}</p>
          <p>Delivery {quote.data ? naira(quote.data.amount) : '—'}</p>
          {quote.data?.zone ? <p className="text-sm text-[#0E1B2C]/70">{quote.data.zone}{quote.data.etaDays != null ? ` · about ${quote.data.etaDays} days` : ''}</p> : null}
          <p className="mt-3 text-sm text-[#0E1B2C]/70">The checkout total includes trade prices, coupons, and the delivery fee PROMEC calculates. A live courier quote falls back to the local tariff when the carrier is not connected.</p>
        </Card>
      </form>
    </Page>
  );
}

function Text({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <Label>{label}<Field value={value} onChange={(event) => onChange(event.target.value)} /></Label>;
}

function Choice({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[][] }) {
  return (
    <Label>{label}
      <Select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </Select>
    </Label>
  );
}
