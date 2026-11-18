export function track(name: string, props?: Record<string, string | number | null>) {
  if (typeof window === 'undefined') return;
  const target = window as Window & { dataLayer?: unknown[] };
  target.dataLayer = target.dataLayer ?? [];
  target.dataLayer.push({ event: name, ...props });
}
