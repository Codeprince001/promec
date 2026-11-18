import { Suspense } from 'react';
import { StoreView } from '../../../components/store/store-view';

export default function StorePage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense fallback={<p className="bg-[#F4F1EC] px-4 py-16 text-[#0E1B2C]">Loading store…</p>}>
      <StoreRoute params={params} />
    </Suspense>
  );
}

async function StoreRoute({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <StoreView slug={slug} />;
}
