import { Suspense } from 'react';
import { RequestScreen } from '@/components/screens/catalogue-screens';

export default function Page() {
  return <Suspense fallback={<p className="px-4 py-8">Loading…</p>}><RequestScreen /></Suspense>;
}
