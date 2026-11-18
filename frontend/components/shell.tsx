'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
    <div className="flex min-h-screen flex-col bg-[#F4F1EC] text-[#0E1B2C]">
      <header className="bg-black text-white">
        <div className="mx-auto max-w-6xl px-4 py-2">
          <div className="flex items-center gap-3">
            <Link href="/" className="shrink-0">
              <img src="/assets/promec_logo.png" alt="PROMEC Limited" width={816} height={306} className="h-12 w-auto sm:h-14" />
            </Link>
            <div className="hidden min-w-0 flex-1 md:block">
              <HeaderSearch />
            </div>
            <nav className="ml-auto hidden items-center gap-1 text-sm md:flex">
              <NavLink href="/stores">Stores</NavLink>
              <NavLink href="/business">Trade</NavLink>
              <NavLink href="/sell">Sell</NavLink>
              <NavLink href="/cart">Cart{count ? ` (${count})` : ''}</NavLink>
              <Link href={signedIn ? '/account' : '/login'} className="inline-flex min-h-11 items-center rounded-full bg-[#F15A24] px-4 text-white">{signedIn ? 'Account' : 'Sign in'}</Link>
            </nav>
            <Link href="/cart" className="ml-auto inline-flex min-h-11 items-center rounded-full bg-white/10 px-4 text-sm md:hidden">Cart{count ? ` ${count}` : ''}</Link>
          </div>
          <div className="mt-2 md:hidden">
            <HeaderSearch />
          </div>
        </div>
        <div className="border-t border-white/10">
          <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-1 text-sm">
            {shownVehicle ? (
              <>
                <Link href="/search" className="inline-flex min-h-11 items-center rounded-full bg-white/10 px-3">{shownVehicle.label}</Link>
                <button type="button" className="inline-flex min-h-11 items-center px-2 text-white/70" onClick={() => setVehicle(null)}>Clear</button>
              </>
            ) : (
              <Link href="/vehicles" className="inline-flex min-h-11 items-center text-white/80">Select a vehicle to check fitment</Link>
            )}
            <Link href="/categories" className="ml-auto hidden min-h-11 items-center text-white/80 sm:inline-flex">Categories</Link>
            <Link href="/brands" className="hidden min-h-11 items-center text-white/80 sm:inline-flex">Brands</Link>
            <Link href="/request-a-part" className="hidden min-h-11 items-center text-white/80 sm:inline-flex">Request a part</Link>
          </div>
        </div>
      </header>
      <div className="flex-1 pb-20 md:pb-0">{children}</div>
      <footer className="mt-8 bg-black text-white">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 text-sm sm:grid-cols-4">
          <div>
            <img src="/assets/promec_logo.png" alt="PROMEC Limited" width={816} height={306} className="h-14 w-auto" />
            <p className="mt-3 text-white/70">PROMEC Limited. Parts desk in Lagos. Prices in naira.</p>
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
          <div className="text-white/70">
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
    <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-[#C4A574]/40 bg-white text-center text-xs md:hidden">
      <Tab href="/" label="Home" />
      <Tab href="/search" label="Search" />
      <Tab href="/vehicles" label="Garage" />
      <Tab href="/cart" label={count ? `Cart ${count}` : 'Cart'} />
      <Tab href={signedIn ? '/account' : '/login'} label="Account" />
    </nav>
  );
}

function Tab({ href, label }: { href: string; label: string }) {
  return <Link href={href} className="flex min-h-11 items-center justify-center px-1 text-[#163A70]">{label}</Link>;
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="inline-flex min-h-11 items-center px-3 text-white/85 hover:text-white">{children}</Link>;
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="inline-flex min-h-11 items-center text-white/80 hover:text-white">{children}</Link>;
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
      <input className="min-h-11 w-full rounded-full bg-white px-4 text-sm text-[#0E1B2C]" placeholder="Part number or name" aria-label="Part number or name" value={q} onChange={(event) => { setQ(event.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
      {open && q.length > 1 ? (
        <div className="absolute z-20 mt-2 w-full rounded-2xl bg-white p-2 text-sm text-[#0E1B2C] shadow-lg">
          {parts.map((part) => <Link key={part.slug} href={`/products/${part.slug}`} className="block rounded-lg px-3 py-2 hover:bg-[#F4F1EC]" onClick={() => setOpen(false)}>{part.name}</Link>)}
          {numbers.map((part) => <Link key={part.number + part.productSlug} href={`/products/${part.productSlug}`} className="block rounded-lg px-3 py-2 hover:bg-[#F4F1EC]" onClick={() => setOpen(false)}>{part.number} · {part.productName}</Link>)}
          {parts.length + numbers.length === 0 ? <p className="px-3 py-2 text-[#0E1B2C]/60">No catalogue matches yet.</p> : null}
        </div>
      ) : null}
    </form>
  );
}
