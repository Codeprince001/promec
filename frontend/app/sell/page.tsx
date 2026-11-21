'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { clearToken, readToken, saveToken } from '../../lib/session';

type PrivateStore = {
  slug: string;
  businessName: string;
  status: string;
  description: string | null;
  phone: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  policies: string | null;
  address: { line: string | null; city: string | null; state: string | null; country: string };
  payout: { bankName: string | null; accountName: string | null; accountNumber: string | null };
  balance?: { available: string };
};

const emptyForm = {
  businessName: '',
  description: '',
  phone: '',
  addressLine: '',
  city: '',
  state: '',
  policies: '',
  logoUrl: '',
  bannerUrl: '',
  payoutBankName: '',
  payoutAccountName: '',
  payoutAccountNumber: '',
};

export default function SellPage() {
  const [token, setToken] = useState<string | null>(null);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [store, setStore] = useState<PrivateStore | null>(null);
  const [missing, setMissing] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [account, setAccount] = useState({ identifier: '', password: '', firstName: '', lastName: '', email: '' });
  const [message, setMessage] = useState('');

  useEffect(() => {
    const current = readToken();
    setToken(current);
    if (current) void loadStore(current);
  }, []);

  async function loadStore(current: string) {
    try {
      const result = await api<{ data: PrivateStore }>('/vendor/store', { token: current });
      setStore(result.data);
      setMissing(false);
      setForm({
        businessName: result.data.businessName,
        description: result.data.description ?? '',
        phone: result.data.phone ?? '',
        addressLine: result.data.address.line ?? '',
        city: result.data.address.city ?? '',
        state: result.data.address.state ?? '',
        policies: result.data.policies ?? '',
        logoUrl: result.data.logoUrl ?? '',
        bannerUrl: result.data.bannerUrl ?? '',
        payoutBankName: result.data.payout.bankName ?? '',
        payoutAccountName: result.data.payout.accountName ?? '',
        payoutAccountNumber: result.data.payout.accountNumber ?? '',
      });
    } catch (reason) {
      const text = reason instanceof Error ? reason.message : '';
      if (text.toLowerCase().includes('open a store')) setMissing(true);
      else setMessage(text);
    }
  }

  async function authenticate(event: FormEvent) {
    event.preventDefault();
    setMessage('');
    try {
      if (mode === 'register') {
        await api('/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            email: account.email,
            password: account.password,
            firstName: account.firstName,
            lastName: account.lastName,
            acceptTerms: true,
          }),
        });
      }
      const result = await api<{ data: { accessToken?: string } }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: mode === 'register' ? account.email : account.identifier, password: account.password }),
      });
      if (!result.data.accessToken) {
        setMessage('Staff sign-in stops at the authenticator. Use the email and password for the seller account.');
        return;
      }
      saveToken(result.data.accessToken);
      setToken(result.data.accessToken);
      await loadStore(result.data.accessToken);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Sign-in failed');
    }
  }

  async function saveStore(event: FormEvent) {
    event.preventDefault();
    setMessage('');
    const body = compact(form);
    try {
      const path = missing ? '/vendors/apply' : '/vendor/store';
      const result = await api<{ data: PrivateStore }>(path, {
        method: missing ? 'POST' : 'PATCH',
        token,
        body: JSON.stringify(body),
      });
      setStore(result.data);
      setMissing(false);
      setMessage(missing ? 'Application sent. PROMEC reviews the store before it goes public.' : 'Store saved.');
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Could not save the store');
    }
  }

  return (
    <div>
      <main className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">Sell</p>
        <h1 className="display mt-1 text-4xl leading-[0.95] sm:text-5xl">Your store</h1>
        <p className="mt-3 max-w-xl text-ink/75">List parts for buyers on PROMEC. PROMEC publishes each part and pays your commission to the account you save here.</p>
        {message ? <p className="mt-4 rounded-xl bg-card px-4 py-3">{message}</p> : null}
        {!token ? (
          <form onSubmit={authenticate} className="mt-8 grid gap-3 rounded-3xl bg-card p-6">
            <div className="flex gap-2">
              <button type="button" className={mode === 'login' ? tabOn : tabOff} onClick={() => setMode('login')}>Sign in</button>
              <button type="button" className={mode === 'register' ? tabOn : tabOff} onClick={() => setMode('register')}>Create account</button>
            </div>
            {mode === 'register' ? (
              <>
                <input className={field} placeholder="First name" value={account.firstName} onChange={(event) => setAccount({ ...account, firstName: event.target.value })} required />
                <input className={field} placeholder="Last name" value={account.lastName} onChange={(event) => setAccount({ ...account, lastName: event.target.value })} required />
                <input className={field} placeholder="Email" type="email" value={account.email} onChange={(event) => setAccount({ ...account, email: event.target.value })} required />
              </>
            ) : (
              <input className={field} placeholder="Email or phone" value={account.identifier} onChange={(event) => setAccount({ ...account, identifier: event.target.value })} required />
            )}
            <input className={field} placeholder={mode === 'register' ? 'Password, at least 10 characters' : 'Password'} type="password" minLength={mode === 'register' ? 10 : 1} value={account.password} onChange={(event) => setAccount({ ...account, password: event.target.value })} required />
            <button className={button} type="submit">{mode === 'register' ? 'Create account' : 'Sign in'}</button>
          </form>
        ) : (
          <>
            {store ? (
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-navy px-5 py-4 text-white">
                <div>
                  <p className="text-sm text-white/70">Status · {store.status}</p>
                  <p className="text-lg font-semibold">{store.businessName}</p>
                </div>
                <div className="flex gap-3 text-sm">
                  {store.status === 'approved' ? <a className="underline" href={`/stores/${store.slug}`}>View public store</a> : null}
                  <a className="underline" href="/sell/listings">Listings</a>
                  <a className="underline" href="/sell/orders">Orders</a>
                  <a className="underline" href="/sell/withdrawals">Withdrawals</a>
                  <button type="button" className="underline" onClick={() => { clearToken(); setToken(null); setStore(null); }}>Sign out</button>
                </div>
              </div>
            ) : null}
            {missing || store ? (
              <form onSubmit={saveStore} className="mt-6 grid gap-3 rounded-3xl bg-card p-6">
                <h2 className="text-xl font-semibold">{missing ? 'Open a store' : 'Store profile'}</h2>
                <Field label="Business name" value={form.businessName} onChange={(value) => setForm({ ...form, businessName: value })} required />
                <Field label="Description" value={form.description} onChange={(value) => setForm({ ...form, description: value })} area />
                <Field label="Phone" value={form.phone} onChange={(value) => setForm({ ...form, phone: value })} />
                <Field label="Address" value={form.addressLine} onChange={(value) => setForm({ ...form, addressLine: value })} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="City" value={form.city} onChange={(value) => setForm({ ...form, city: value })} />
                  <Field label="State" value={form.state} onChange={(value) => setForm({ ...form, state: value })} />
                </div>
                <Field label="Logo URL" value={form.logoUrl} onChange={(value) => setForm({ ...form, logoUrl: value })} />
                <Field label="Banner URL" value={form.bannerUrl} onChange={(value) => setForm({ ...form, bannerUrl: value })} />
                <Field label="Returns and shipping policy" value={form.policies} onChange={(value) => setForm({ ...form, policies: value })} area />
                <h3 className="mt-2 font-semibold">Payout account</h3>
                <Field label="Bank" value={form.payoutBankName} onChange={(value) => setForm({ ...form, payoutBankName: value })} />
                <Field label="Account name" value={form.payoutAccountName} onChange={(value) => setForm({ ...form, payoutAccountName: value })} />
                <Field label="Account number" value={form.payoutAccountNumber} onChange={(value) => setForm({ ...form, payoutAccountNumber: value })} />
                <button className={button} type="submit">{missing ? 'Submit application' : 'Save store'}</button>
              </form>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}

function Field({ label, value, onChange, area, required }: { label: string; value: string; onChange: (value: string) => void; area?: boolean; required?: boolean }) {
  const className = `${field} w-full`;
  return (
    <label className="grid gap-1 text-sm">
      {label}
      {area ? <textarea className={className} value={value} onChange={(event) => onChange(event.target.value)} required={required} /> : <input className={className} value={value} onChange={(event) => onChange(event.target.value)} required={required} />}
    </label>
  );
}

function compact(form: typeof emptyForm) {
  const entries = Object.entries(form).filter(([, value]) => value.trim() !== '');
  return Object.fromEntries(entries);
}

const field = 'control';
const button = 'inline-flex min-h-11 items-center justify-center rounded-full bg-brand px-5 text-sm font-medium text-white';
const tabOn = 'inline-flex min-h-11 items-center rounded-full bg-navy px-4 text-sm text-white';
const tabOff = 'inline-flex min-h-11 items-center rounded-full px-4 text-sm text-link';
