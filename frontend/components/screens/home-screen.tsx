'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { VehicleFinder } from '@/components/finder';
import { api, unwrap } from '@/lib/api';
import type { Category } from '@/lib/types';
import { useMounted } from '@/lib/use-mounted';

const steps = [
  { n: '01', title: 'Name the vehicle', body: 'Make, model, and year, or a 17-character VIN.' },
  { n: '02', title: 'Read the fitment', body: 'Confirmed, probable, unverified, or incompatible. Nothing else.' },
  { n: '03', title: 'Pay in naira', body: 'Paystack, a bank transfer with proof, or approved trade credit.' },
  { n: '04', title: 'Collect or ship', body: 'GIG, DHL, or pickup from the Lagos warehouse.' },
];

const fitment = [
  { title: 'Confirmed', body: 'A catalogue record matches this vehicle.', mark: 'bg-emerald-500' },
  { title: 'Probable', body: 'The record is close. Read the note before you buy.', mark: 'bg-amber-400' },
  { title: 'Unverified', body: 'No fitment record yet. Ask PROMEC before fitting.', mark: 'bg-[#C4A574]' },
  { title: 'Incompatible', body: 'This part is recorded as the wrong vehicle.', mark: 'bg-[#F15A24]' },
];

export function HomeScreen() {
  const mounted = useMounted();
  const categories = useQuery({
    queryKey: ['categories'],
    enabled: mounted,
    queryFn: async () => unwrap(await api<{ data: Category[] }>('/categories')),
  });
  const roots = (categories.data ?? []).filter((category) => !category.parentId);

  return (
    <main>
      <section className="relative overflow-hidden bg-black text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_78%_42%,rgba(22,58,112,0.95),transparent_55%)]" />
        <div className="pointer-events-none absolute -left-24 top-8 h-56 w-56 rounded-full bg-[#F15A24]/20 blur-3xl" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-2 px-4 pt-8 md:grid-cols-[1.05fr_0.95fr] md:pt-12">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-[#F15A24]">Lagos parts desk</p>
            <h1 className="display mt-3 text-5xl leading-[0.88] sm:text-6xl lg:text-7xl">
              The right part for the vehicle in front of you.
            </h1>
            <p className="mt-4 max-w-md text-base text-white/75">
              Search by vehicle, VIN, or part number. A fit is recorded only when the catalogue and the vehicle agree. Prices are in naira.
            </p>
          </div>
          <HeroCar className="mx-auto w-full max-w-md md:max-w-none" />
        </div>
        <div className="relative mx-auto -mt-6 max-w-6xl px-4 pb-8 md:-mt-10">
          <VehicleFinder />
        </div>
      </section>

      <section className="border-b border-[#C4A574]/40 bg-white">
        <div className="mx-auto grid max-w-6xl gap-4 px-4 py-5 text-sm sm:grid-cols-3">
          <Fact kicker="Prices" body="Listed in naira. Supplier cost stays on the purchase side." />
          <Fact kicker="Stock" body="One Lagos warehouse at launch, reserved when you check out." />
          <Fact kicker="Delivery" body="GIG, DHL, or you collect from the warehouse." />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-[#F15A24]">Catalogue</p>
            <h2 className="display mt-1 text-4xl">Start with the part group.</h2>
          </div>
          <Link href="/categories" className="text-sm text-[#163A70] underline">All categories</Link>
        </div>
        {categories.isError ? <p className="mt-3">{categories.error.message}</p> : null}
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {roots.map((category) => (
            <Link key={category.id} href={`/categories/${category.slug}`} className="group rounded-2xl border border-[#C4A574]/40 bg-white px-5 py-6 transition hover:-translate-y-0.5 hover:border-[#F15A24]">
              <p className="text-xs uppercase tracking-[0.16em] text-[#F15A24]">Shop</p>
              <p className="display mt-2 text-3xl text-[#163A70] group-hover:text-[#F15A24]">{category.name}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="bg-[#163A70] text-white">
        <div className="mx-auto max-w-6xl px-4 py-12">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-[#F15A24]">Fitment</p>
          <h2 className="display mt-1 max-w-xl text-4xl">Four answers. The catalogue decides, not the search box.</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {fitment.map((item) => (
              <article key={item.title}>
                <span className={`inline-block h-1.5 w-10 rounded-full ${item.mark}`} />
                <h3 className="mt-3 text-lg font-semibold">{item.title}</h3>
                <p className="mt-1 text-sm text-white/75">{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-[#F15A24]">From the desk</p>
        <h2 className="display mt-1 text-4xl">How an order moves.</h2>
        <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step) => (
            <li key={step.n} className="rounded-2xl bg-white p-5">
              <p className="display text-3xl text-[#F15A24]">{step.n}</p>
              <h3 className="mt-2 font-semibold text-[#163A70]">{step.title}</h3>
              <p className="mt-1 text-sm text-[#0E1B2C]/75">{step.body}</p>
            </li>
          ))}
        </ol>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <Panel title="Workshops and fleets" body="Open a trade account, request a quote, and pay on terms after PROMEC approves the limit." href="/business" label="Trade desk" />
          <Panel title="Can’t find the part?" body="Send the number, the vehicle, and how to reach you. PROMEC quotes it from the catalogue." href="/request-a-part" label="Request a part" />
          <Panel title="Sell on PROMEC" body="Apply with your store details. Listings stay in review until PROMEC publishes them." href="/sell" label="Open a store" />
        </div>
      </section>
    </main>
  );
}

function HeroCar({ className = '' }: { className?: string }) {
  return (
    <img
      src="/assets/car.png"
      alt="Silver SUV"
      width={500}
      height={500}
      className={`mix-blend-lighten ${className}`}
    />
  );
}

function Fact({ kicker, body }: { kicker: string; body: string }) {
  return (
    <p>
      <span className="font-semibold text-[#163A70]">{kicker}. </span>
      <span className="text-[#0E1B2C]/75">{body}</span>
    </p>
  );
}

function Panel({ title, body, href, label }: { title: string; body: string; href: string; label: string }) {
  return (
    <article className="rounded-2xl bg-[#0E1B2C] p-5 text-white">
      <h2 className="display text-2xl">{title}</h2>
      <p className="mt-2 text-sm text-white/75">{body}</p>
      <Link href={href} className="mt-4 inline-block text-sm text-[#F15A24]">{label}</Link>
    </article>
  );
}
