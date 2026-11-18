import { Suspense } from 'react';
import { ProductScreen } from '@/components/screens/product-screen';

export default function Page({ params }: { params: Promise<{ slug: string }> }) {
  return <Suspense fallback={<p className="px-4 py-8">Loading part…</p>}><Load params={params} /></Suspense>;
}

async function Load({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ProductScreen slug={slug} />;
}
