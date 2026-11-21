import Link from 'next/link';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

export const primaryClass = 'inline-flex min-h-11 items-center justify-center rounded-full bg-brand px-5 text-sm font-medium text-white transition hover:brightness-95 disabled:opacity-50';
export const navyClass = 'inline-flex min-h-11 items-center justify-center rounded-full bg-navy px-5 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-50';
export const ghostClass = 'inline-flex min-h-11 items-center justify-center rounded-full border border-link px-5 text-sm font-medium text-link transition hover:bg-card disabled:opacity-50';

export function Button({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`${primaryClass} ${className}`} {...props} />;
}

export function GhostButton({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`${ghostClass} ${className}`} {...props} />;
}

export function Field({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`control ${className}`} {...props} />;
}

export function Area({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`control min-h-28 ${className}`} {...props} />;
}

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`control ${className}`} {...props} />;
}

export function Label({ children }: { children: ReactNode }) {
  return <label className="grid gap-1 text-sm">{children}</label>;
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl bg-card p-5 ${className}`}>{children}</section>;
}

export function Notice({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-gold/50 bg-card px-4 py-3 text-sm">{children}</p>;
}

export function Page({ children, width = '6xl' }: { children: ReactNode; width?: 'md' | 'xl' | '3xl' | '4xl' | '6xl' }) {
  const max = { md: 'max-w-md', xl: 'max-w-xl', '3xl': 'max-w-3xl', '4xl': 'max-w-4xl', '6xl': 'max-w-6xl' }[width];
  return <main className={`mx-auto ${max} px-4 py-8 md:py-10`}>{children}</main>;
}

export function PageHead({ kicker, title, lede }: { kicker?: string; title: string; lede?: string }) {
  return (
    <header className="max-w-2xl">
      {kicker ? <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">{kicker}</p> : null}
      <h1 className="display mt-1 text-4xl leading-[0.95] sm:text-5xl">{title}</h1>
      {lede ? <p className="mt-3 text-ink/75">{lede}</p> : null}
    </header>
  );
}

export function Loading({ label }: { label: string }) {
  return <p className="mt-6 text-sm text-ink/70">{label}</p>;
}

export function Empty({ title, body, href, label }: { title: string; body: string; href?: string; label?: string }) {
  return (
    <div className="mt-6 rounded-2xl border border-dashed border-gold bg-card px-5 py-8">
      <p className="display text-3xl text-link">{title}</p>
      <p className="mt-2 max-w-md text-sm text-ink/75">{body}</p>
      {href && label ? <Link href={href} className={`${primaryClass} mt-5`}>{label}</Link> : null}
    </div>
  );
}

export function ProductGrid({ children }: { children: ReactNode }) {
  return <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}

export function FitmentBadge({ status }: { status: string }) {
  const tone = status === 'confirmed' ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200' : status === 'probable' ? 'bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-200' : status === 'incompatible' ? 'bg-brand/15 text-[#9a3412] dark:text-orange-200' : 'bg-paper text-ink';
  return <span className={`inline-flex min-h-7 items-center rounded-full px-2.5 text-xs font-medium uppercase tracking-wide ${tone}`}>{status}</span>;
}
