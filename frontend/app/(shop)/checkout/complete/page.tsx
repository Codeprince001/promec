import { Suspense } from 'react';
import { CompleteScreen } from '@/components/screens/complete-screen';

export default function Page() {
  return <Suspense fallback={<p className="px-4 py-8">Loading order…</p>}><CompleteScreen /></Suspense>;
}
