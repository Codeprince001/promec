import { Suspense } from 'react';
import { SearchScreen } from '@/components/screens/search-screen';

export default function Page() {
  return <Suspense fallback={<p className="px-4 py-8">Searching…</p>}><SearchScreen /></Suspense>;
}
