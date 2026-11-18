import { Suspense } from 'react';
import { ResetScreen } from '@/components/screens/auth-screens';

export default function Page() {
  return <Suspense fallback={<p className="px-4 py-8">Loading…</p>}><ResetScreen /></Suspense>;
}
