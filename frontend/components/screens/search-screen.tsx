'use client';

import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { ProductCard } from '@/components/product-card';
import { Empty, Loading, Notice, Page, PageHead, ProductGrid } from '@/components/ui';
import { api } from '@/lib/api';
import { useDesk } from '@/lib/desk';
import { useMounted } from '@/lib/use-mounted';
import type { ProductCardData } from '@/lib/types';

export function SearchScreen() {
  const mounted = useMounted();
  const params = useSearchParams();
  const q = params.get('q') ?? '';
  const category = params.get('category') ?? '';
  const storedVehicle = useDesk((state) => state.vehicle);
  const vehicle = mounted ? storedVehicle : null;
  const search = useQuery({
    queryKey: ['search', q, category, vehicle?.variantId, vehicle?.year],
    enabled: mounted,
    queryFn: async () => {
      const query = new URLSearchParams();
      if (q) query.set('q', q);
      if (category) query.set('category', category);
      if (vehicle?.variantId) query.set('vehicleVariantId', vehicle.variantId);
      if (vehicle?.year) query.set('year', String(vehicle.year));
      const body = await api<{ data: ProductCardData[] }>(`/search?${query.toString()}`);
      return body.data;
    },
  });
  const title = q ? `Results for ${q}` : vehicle ? `Parts for ${vehicle.label}` : 'Search the catalogue';

  return (
    <Page>
      <PageHead kicker="Catalogue" title={title} lede={vehicle ? 'A badge appears on the part page after this vehicle is checked. A search result is not a fit by itself.' : 'Choose a vehicle before treating a result as a fit.'} />
      {!mounted || search.isLoading ? <Loading label="Searching…" /> : null}
      {search.isError ? <div className="mt-4"><Notice>{search.error.message}</Notice></div> : null}
      {search.data && search.data.length === 0 ? <Empty title="Nothing matched" body="The catalogue has no published part for that search." href={`/request-a-part?q=${encodeURIComponent(q)}`} label="Request this part" /> : null}
      <ProductGrid>{(search.data ?? []).map((product) => <ProductCard key={product.slug} product={product} />)}</ProductGrid>
    </Page>
  );
}
