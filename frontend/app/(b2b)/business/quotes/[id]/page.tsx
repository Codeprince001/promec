import { Suspense } from 'react';
import { QuoteOrderScreen } from '@/components/screens/business-screens';

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<p className="px-4 py-8">Loading…</p>}><Load params={params} /></Suspense>;
}

async function Load({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <QuoteOrderScreen id={id} />;
}
