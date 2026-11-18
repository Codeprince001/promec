import { Suspense } from 'react';
import { VerifyScreen } from '@/components/screens/auth-screens';

export default function Page() {
  return <Suspense fallback={<p className="px-4 py-8">Loading…</p>}><VerifyScreen /></Suspense>;
}
