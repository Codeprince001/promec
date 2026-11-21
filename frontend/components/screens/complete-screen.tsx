'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button, Card, Field, Notice, Page, PageHead, primaryClass } from '@/components/ui';
import { api } from '@/lib/api';
import { naira } from '@/lib/money';
import type { OrderBody } from '@/lib/types';

export function CompleteScreen() {
  const params = useSearchParams();
  const [order, setOrder] = useState<OrderBody | null>(null);
  const [proof, setProof] = useState({ amount: '', bankReference: '', evidenceUrl: '' });
  const [message, setMessage] = useState('');

  useEffect(() => {
    const raw = sessionStorage.getItem('promec.checkout');
    if (!raw) return;
    const parsed = JSON.parse(raw) as OrderBody;
    if (!params.get('order') || parsed.id === params.get('order')) setOrder(parsed);
  }, [params]);

  async function sendProof(event: FormEvent) {
    event.preventDefault();
    if (!order?.bankTransfer?.reference) return;
    setMessage('');
    try {
      await api(`/payments/${order.bankTransfer.reference}/proof`, {
        method: 'POST',
        body: JSON.stringify({ amount: Number(proof.amount), bankReference: proof.bankReference, evidenceUrl: proof.evidenceUrl }),
      });
      setMessage('Proof received. PROMEC matches it before the order is marked paid.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Proof was not accepted');
    }
  }

  if (!order) {
    return (
      <Page width="3xl">
        <PageHead kicker="Checkout" title="Order details stay in this browser" lede="Open your account if you already signed in." />
        <Link className={`${primaryClass} mt-6`} href="/account/orders">Open your orders</Link>
      </Page>
    );
  }

  return (
    <Page width="3xl">
      <PageHead kicker="Checkout" title={`Order ${order.orderNo}`} lede={`Status ${order.status.replaceAll('_', ' ')} · payment ${order.paymentStatus.replaceAll('_', ' ')} · ${naira(order.grandTotal)}`} />
      {order.bankTransfer ? (
        <Card className="mt-6">
          <h2 className="display text-3xl text-link">Transfer {naira(order.bankTransfer.amount)}</h2>
          <p className="mt-2">{order.bankTransfer.accountName}</p>
          <p>{order.bankTransfer.bankName} · {order.bankTransfer.accountNumber}</p>
          <p>Reference {order.bankTransfer.reference}</p>
          <form onSubmit={sendProof} className="mt-4 grid gap-3">
            <Field placeholder="Amount sent" value={proof.amount} onChange={(event) => setProof({ ...proof, amount: event.target.value })} required />
            <Field placeholder="Bank reference" value={proof.bankReference} onChange={(event) => setProof({ ...proof, bankReference: event.target.value })} required />
            <Field placeholder="https link to the receipt" value={proof.evidenceUrl} onChange={(event) => setProof({ ...proof, evidenceUrl: event.target.value })} required />
            <Button type="submit">Send proof</Button>
          </form>
        </Card>
      ) : null}
      {message ? <div className="mt-4"><Notice>{message}</Notice></div> : null}
      <Link className="mt-6 inline-flex min-h-11 items-center text-link" href={`/account/orders/${order.id}`}>View this order</Link>
    </Page>
  );
}
