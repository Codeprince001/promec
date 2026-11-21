export function SiteHeader() {
  return (
    <header className="bg-navy text-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <a href="/" className="text-2xl tracking-tight">
          <span className="font-semibold italic text-accent">Pro</span>
          <span className="font-semibold">Mec</span>
        </a>
        <nav className="flex items-center gap-5 text-sm">
          <a href="/stores" className="hover:text-accent">Stores</a>
          <a href="/sell" className="rounded-full bg-brand px-4 py-2 font-medium text-white">Sell on PROMEC</a>
        </nav>
      </div>
    </header>
  );
}
