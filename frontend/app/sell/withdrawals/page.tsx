'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { readToken } from '../../../lib/session';
import { naira } from '../../../lib/money';

type Withdrawal = {
  id: string;
  amount: string;
  status: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  reference: string | null;
  requestedAt: string;
};

type Balance = { ledger: string; reserved: string; available: string };

export default function WithdrawalsPage() {
  const [token, setToken] = useState<string | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [rows, setRows] = useState<Withdrawal[]>([]);
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const current = readToken();
    setToken(current);
    if (current) void load(current);
  }, []);

  async function load(current: string) {
    try {
      const result = await api<{ data: { balance: Balance; withdrawals: Withdrawal[] } }>('/vendor/withdrawals', { token: current });
      setBalance(result.data.balance);
      setRows(result.data.withdrawals);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Could not load withdrawals');
    }
  }

  async function request(event: FormEvent) {
    event.preventDefault();
    setMessage('');
    try {
      await api('/vendor/withdrawals', {
        method: 'POST',
        token,
        body: JSON.stringify({ amount: Number(amount) }),
      });
      setAmount('');
      setMessage('Withdrawal requested. PROMEC pays it after approval.');
      if (token) await load(token);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Request failed');
    }
  }

  return (
    <div>
      <main className="mx-auto max-w-3xl px-4 py-10">
        <a href="/sell" className="inline-flex min-h-11 items-center text-sm text-link">Back to store</a>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">Sell</p>
        <h1 className="display mt-1 text-4xl">Withdrawals</h1>
        {!token ? <p className="mt-6">Sign in from the store page first.</p> : null}
        {message ? <p className="mt-4 rounded-xl bg-card px-4 py-3">{message}</p> : null}
        {balance ? (
          <section className="mt-6 grid gap-3 sm:grid-cols-3">
            <Stat label="Available" value={naira(balance.available)} />
            <Stat label="On request" value={naira(balance.reserved)} />
            <Stat label="Ledger" value={naira(balance.ledger)} />
          </section>
        ) : null}
        {token ? (
          <form onSubmit={request} className="mt-6 flex flex-wrap items-end gap-3 rounded-3xl bg-card p-6">
            <label className="grid gap-1 text-sm">
              Amount in naira
              <input className="control" value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" required />
            </label>
            <button className="inline-flex min-h-11 items-center justify-center rounded-full bg-brand px-5 text-sm font-medium text-white" type="submit">Request withdrawal</button>
            <p className="w-full text-sm text-ink/70">The smallest request is ₦1,000. It uses the payout account saved on the store, and it stays reserved until PROMEC pays or rejects it.</p>
          </form>
        ) : null}
        <div className="mt-6 space-y-3">
          {rows.map((row) => (
            <article key={row.id} className="rounded-2xl bg-card p-4">
              <div className="flex items-center justify-between">
                <p className="text-lg font-semibold">{naira(row.amount)}</p>
                <p className="text-sm uppercase tracking-wide text-link">{row.status}</p>
              </div>
              <p className="mt-2 text-sm">{row.bankName} · {row.accountName} · {row.accountNumber}</p>
              {row.reference ? <p className="mt-1 text-sm">Reference {row.reference}</p> : null}
            </article>
          ))}
        </div>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-navy p-4 text-white">
      <p className="text-sm text-white/70">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}
