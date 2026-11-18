import { Suspense } from 'react';
import { OrderScreen } from '@/components/screens/account-screens';

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<p className="px-4 py-8">Loading order…</p>}><Load params={params} /></Suspense>;
}

async function Load({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OrderScreen id={id} />;
}
