'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Car, Home, Search, ShoppingCart, User, type LucideIcon } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { rememberCart } from '@/lib/api';
import { useDesk } from '@/lib/desk';
import { useSession } from '@/lib/session';
import type { CartBody } from '@/lib/types';

export function Shell({ children }: { children: React.ReactNode }) {
  const token = useSession((state) => state.token);
  const vehicle = useDesk((state) => state.vehicle);
  const setVehicle = useDesk((state) => state.setVehicle);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const cart = useQuery({
    queryKey: ['cart', token],
    enabled: ready,
    queryFn: () => rememberCart<CartBody>('/cart'),
  });
  const count = ready ? cart.data?.data.items.reduce((sum, item) => sum + item.qty, 0) ?? 0 : 0;
  const shownVehicle = ready ? vehicle : null;
  const signedIn = ready && Boolean(token);

  return (
    <div className="flex min-h-screen flex-col bg-paper text-ink">
      <header className="site-header sticky top-0 z-40">
        <div className="mx-auto max-w-6xl px-4 py-2">
          <div className="flex items-center gap-3">
            <Link href="/" className="logo-mark shrink-0">
              <img src="/assets/promec_logo.png" alt="PROMEC Limited" width={816} height={306} className="h-14 w-auto drop-shadow-[0_8px_14px_rgba(0,30,84,0.22)] sm:h-16 dark:drop-shadow-none" />
            </Link>
            <div className="hidden min-w-0 flex-1 md:block">
              <HeaderSearch />
            </div>
            <nav className="ml-auto hidden items-center gap-1 text-sm md:flex">
              <NavLink href="/stores">Stores</NavLink>
              <NavLink href="/business">Trade</NavLink>
              <NavLink href="/sell">Sell</NavLink>
              <NavLink href="/cart">Cart{count ? ` (${count})` : ''}</NavLink>
              <ThemeToggle />
              <Link href={signedIn ? '/account' : '/login'} className="inline-flex min-h-11 items-center rounded-full bg-brand px-4 text-white">{signedIn ? 'Account' : 'Sign in'}</Link>
            </nav>
            <div className="ml-auto flex items-center md:hidden">
              <ThemeToggle />
              <Link href="/cart" className="inline-flex min-h-11 items-center rounded-full bg-on-header/10 px-4 text-sm">Cart{count ? ` ${count}` : ''}</Link>
            </div>
          </div>
          <div className="mt-2 md:hidden">
            <HeaderSearch />
          </div>
        </div>
        <div className="border-t border-on-header/10">
          <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-1 text-sm">
            {shownVehicle ? (
              <>
                <Link href="/search" className="inline-flex min-h-11 items-center rounded-full bg-on-header/10 px-3">{shownVehicle.label}</Link>
                <button type="button" className="inline-flex min-h-11 items-center px-2 text-on-header/70" onClick={() => setVehicle(null)}>Clear</button>
              </>
            ) : (
              <Link href="/vehicles" className="inline-flex min-h-11 items-center text-on-header/80">Select a vehicle to check fitment</Link>
            )}
            <Link href="/categories" className="ml-auto hidden min-h-11 items-center text-on-header/80 sm:inline-flex">Categories</Link>
            <Link href="/brands" className="hidden min-h-11 items-center text-on-header/80 sm:inline-flex">Brands</Link>
            <Link href="/request-a-part" className="hidden min-h-11 items-center text-on-header/80 sm:inline-flex">Request a part</Link>
          </div>
        </div>
      </header>
      <div className="flex-1 pb-20 md:pb-0">{children}</div>
      <footer className="site-footer mt-8">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 text-sm sm:grid-cols-4">
          <div>
            <span className="logo-mark">
              <img src="/assets/promec_logo.png" alt="PROMEC Limited" width={816} height={306} className="h-14 w-auto drop-shadow-[0_8px_14px_rgba(0,30,84,0.22)] dark:drop-shadow-none" />
            </span>
            <p className="mt-3 text-on-header/70">PROMEC Limited. Parts desk in Lagos. Prices in naira.</p>
          </div>
          <div className="grid">
            <FooterLink href="/about">About</FooterLink>
            <FooterLink href="/contact">Contact</FooterLink>
            <FooterLink href="/faq">FAQ</FooterLink>
            <FooterLink href="/track">Track a parcel</FooterLink>
          </div>
          <div className="grid">
            <FooterLink href="/delivery-returns">Delivery and returns</FooterLink>
            <FooterLink href="/privacy">Privacy</FooterLink>
            <FooterLink href="/terms">Terms</FooterLink>
            <FooterLink href="/support">Support</FooterLink>
          </div>
          <div className="text-on-header/70">
            <p>Paystack, bank transfer, and approved trade credit.</p>
            <p className="mt-2">GIG, DHL, or pickup from the Lagos warehouse.</p>
          </div>
        </div>
      </footer>
      <BottomNav count={count} signedIn={signedIn} />
    </div>
  );
}

function BottomNav({ count, signedIn }: { count: number; signedIn: boolean }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-gold/40 bg-card text-center text-[11px] md:hidden">
      <Tab href="/" label="Home" icon={Home} />
      <Tab href="/search" label="Search" icon={Search} />
      <Tab href="/vehicles" label="Garage" icon={Car} />
      <Tab href="/cart" label={count ? `Cart ${count}` : 'Cart'} icon={ShoppingCart} />
      <Tab href={signedIn ? '/account' : '/login'} label="Account" icon={User} />
    </nav>
  );
}

function Tab({ href, label, icon: Icon }: { href: string; label: string; icon: LucideIcon }) {
  return (
    <Link href={href} className="flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-link">
      <Icon className="size-5" strokeWidth={1.75} aria-hidden />
      <span>{label}</span>
    </Link>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="inline-flex min-h-11 items-center px-3 text-on-header/80 hover:text-on-header">{children}</Link>;
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="inline-flex min-h-11 items-center text-on-header/80 hover:text-on-header">{children}</Link>;
}

function HeaderSearch() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const suggest = useQuery({
    queryKey: ['suggest', q],
    enabled: q.trim().length > 1,
    queryFn: () => fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1'}/search/suggest?q=${encodeURIComponent(q)}`).then((response) => response.json()) as Promise<{ data: { parts: { slug: string; name: string }[]; partNumbers: { number: string; productSlug: string; productName: string }[] } }>,
  });

  function go(event: FormEvent) {
    event.preventDefault();
    setOpen(false);
    router.push(`/search?q=${encodeURIComponent(q)}`);
  }

  const parts = suggest.data?.data?.parts ?? [];
  const numbers = suggest.data?.data?.partNumbers ?? [];

  return (
    <form onSubmit={go} className="relative min-w-0">
      <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-ink/50" aria-hidden />
      <input className="min-h-11 w-full rounded-full border border-gold/50 bg-card py-2 pr-4 pl-11 text-sm text-ink" placeholder="Part number or name" aria-label="Part number or name" value={q} onChange={(event) => { setQ(event.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
      {open && q.length > 1 ? (
        <div className="absolute z-20 mt-2 w-full rounded-2xl bg-card p-2 text-sm text-ink shadow-lg">
          {parts.map((part) => <Link key={part.slug} href={`/products/${part.slug}`} className="block rounded-lg px-3 py-2 hover:bg-paper" onClick={() => setOpen(false)}>{part.name}</Link>)}
          {numbers.map((part) => <Link key={part.number + part.productSlug} href={`/products/${part.productSlug}`} className="block rounded-lg px-3 py-2 hover:bg-paper" onClick={() => setOpen(false)}>{part.number} · {part.productName}</Link>)}
          {parts.length + numbers.length === 0 ? <p className="px-3 py-2 text-ink/60">No catalogue matches yet.</p> : null}
        </div>
      ) : null}
    </form>
  );
}
