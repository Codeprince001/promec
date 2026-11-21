'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { api, rememberCart, unwrap } from '@/lib/api';
import { useDesk } from '@/lib/desk';
import { saveToken } from '@/lib/session';
import { loginSchema, registerSchema } from '@/lib/validators/forms';
import { Button, Field, Notice, Page, PageHead } from '@/components/ui';
import type { CartBody } from '@/lib/types';

export function LoginScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const client = useQueryClient();
  const guest = useDesk((state) => state.guestToken);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = loginSchema.safeParse({ identifier, password });
    if (!parsed.success) return setMessage(parsed.error.issues[0]?.message ?? 'Check the form');
    setMessage('');
    try {
      const body = await api<{ data: { accessToken?: string; mfaRequired?: boolean; challengeId?: string } }>('/auth/login', {
        method: 'POST',
        token: null,
        body: JSON.stringify(parsed.data),
      });
      const result = unwrap(body);
      if (result.mfaRequired && result.challengeId) {
        setChallengeId(result.challengeId);
        return;
      }
      if (!result.accessToken) return setMessage('Sign-in did not return a session');
      await finish(result.accessToken);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Sign-in failed');
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    try {
      const body = await api<{ data: { accessToken: string } }>('/auth/mfa/verify', { method: 'POST', token: null, body: JSON.stringify({ challengeId, code }) });
      await finish(unwrap(body).accessToken);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'That code was not accepted');
    }
  }

  async function finish(token: string) {
    saveToken(token);
    if (guest) {
      try { await rememberCart<CartBody>('/cart/merge', { method: 'POST', body: JSON.stringify({ guestToken: guest }) }); } catch { /* guest cart may already be empty */ }
    }
    await client.invalidateQueries({ queryKey: ['cart'] });
    router.push(params.get('next') || '/account');
  }

  return (
    <AuthCard kicker="Account" title="Sign in" lede="Customers and sellers use email and a password. Staff stay on the authenticator.">
      {message ? <Notice>{message}</Notice> : null}
      {challengeId ? (
        <form onSubmit={verify} className="grid gap-3">
          <Field placeholder="6-digit authenticator code" value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" />
          <Button type="submit">Verify</Button>
        </form>
      ) : (
        <form onSubmit={submit} className="grid gap-3">
          <Field placeholder="Email or phone" value={identifier} onChange={(event) => setIdentifier(event.target.value)} autoComplete="username" />
          <Field placeholder="Password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
          <Button type="submit">Sign in</Button>
        </form>
      )}
      <p className="text-sm"><Link className="text-link underline" href="/register">Create an account</Link> · <Link className="text-link underline" href="/forgot-password">Forgot password</Link></p>
    </AuthCard>
  );
}

export function RegisterScreen() {
  const router = useRouter();
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '', customerType: 'individual', acceptTerms: false });
  const [message, setMessage] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = registerSchema.safeParse({ ...form, acceptTerms: form.acceptTerms ? true : undefined });
    if (!parsed.success) return setMessage(parsed.error.issues[0]?.message ?? 'Check the form');
    try {
      const body = await api<{ data: { accessToken?: string } }>('/auth/register', { method: 'POST', token: null, body: JSON.stringify(parsed.data) });
      const token = unwrap(body).accessToken;
      if (token) saveToken(token);
      router.push('/account');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Registration failed');
    }
  }

  return (
    <AuthCard kicker="Account" title="Create an account" lede="A workshop can register as a mechanic or a business member. Terms are required.">
      {message ? <Notice>{message}</Notice> : null}
      <form onSubmit={submit} className="grid gap-3">
        <div className="flex flex-wrap gap-2 text-sm">
          {(['individual', 'mechanic', 'business_member'] as const).map((type) => (
            <button key={type} type="button" className={form.customerType === type ? 'inline-flex min-h-11 items-center rounded-full bg-navy px-4 text-white' : 'inline-flex min-h-11 items-center rounded-full px-4 text-link'} onClick={() => setForm({ ...form, customerType: type })}>{type === 'business_member' ? 'Business' : type}</button>
          ))}
        </div>
        <Field placeholder="First name" value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} />
        <Field placeholder="Last name" value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} />
        <Field placeholder="Email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
        <Field placeholder="Password, at least 10 characters" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={form.acceptTerms} onChange={(event) => setForm({ ...form, acceptTerms: event.target.checked })} /> I accept the terms</label>
        <Button type="submit">Create account</Button>
      </form>
    </AuthCard>
  );
}

export function ForgotScreen() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await api('/auth/password/forgot', { method: 'POST', token: null, body: JSON.stringify({ email }) });
      setMessage('If that email is registered, a reset link is on its way.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Request failed');
    }
  }
  return <AuthCard kicker="Account" title="Reset password" lede="If that email is registered, the link is sent. The reply is the same either way."><form onSubmit={submit} className="grid gap-3"><Field value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" /><Button type="submit">Send link</Button>{message ? <Notice>{message}</Notice> : null}</form></AuthCard>;
}

export function ResetScreen() {
  const params = useSearchParams();
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await api('/auth/password/reset', { method: 'POST', token: null, body: JSON.stringify({ token: params.get('token'), password }) });
      setMessage('Password updated. Sign in with the new password.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Reset failed');
    }
  }
  return <AuthCard kicker="Account" title="Choose a new password" lede="Use at least 10 characters."><form onSubmit={submit} className="grid gap-3"><Field type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="New password" /><Button type="submit">Update password</Button>{message ? <Notice>{message}</Notice> : null}</form></AuthCard>;
}

export function VerifyScreen() {
  const params = useSearchParams();
  const [message, setMessage] = useState('Confirming your email…');
  useEffect(() => {
    const token = params.get('token');
    if (!token) {
      setMessage('This link is missing a token.');
      return;
    }
    api('/auth/email/verify', { method: 'POST', token: null, body: JSON.stringify({ token }) }).then(() => setMessage('Email confirmed.')).catch((error: Error) => setMessage(error.message));
  }, [params]);
  return <AuthCard kicker="Account" title="Email" lede={message}><span /></AuthCard>;
}

function AuthCard({ kicker, title, lede, children }: { kicker: string; title: string; lede?: string; children: React.ReactNode }) {
  return (
    <Page width="md">
      <div className="grid gap-4 rounded-2xl bg-card p-5 sm:p-6">
        <PageHead kicker={kicker} title={title} lede={lede} />
        {children}
      </div>
    </Page>
  );
}
