import { Suspense } from 'react';
import { CategoryScreen } from '@/components/screens/catalogue-screens';

export default function Page({ params }: { params: Promise<{ slug: string }> }) {
  return <Suspense fallback={<p className="px-4 py-8">Loading category…</p>}><Load params={params} /></Suspense>;
}

async function Load({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <CategoryScreen slug={slug} />;
}
