export function Article({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8 md:py-10">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">PROMEC Limited</p>
      <h1 className="display mt-1 text-4xl leading-[0.95] sm:text-5xl">{title}</h1>
      <div className="mt-6 space-y-4 rounded-2xl bg-card p-5 leading-7 text-ink/85 sm:p-6">{children}</div>
    </main>
  );
}

export function AboutPage() {
  return <Article title="About PROMEC"><p>PROMEC Limited sells automotive parts in Nigeria. The launch desk is inventory PROMEC holds, plus approved stores that list their own stock.</p><p>A part is priced in naira. Fitment is confirmed, probable, unverified, or incompatible, and only the catalogue decides that. The parts assistant repeats catalogue matches. It does not invent a fit, a price, or a payment.</p><p>The working warehouse is in Lagos. The records can hold more than one warehouse when stock needs to move.</p></Article>;
}

export function FaqPage() {
  return <Article title="FAQ"><p>Paystack takes card payments. A bank transfer needs the PROMEC account, your reference, and a receipt link before staff mark it paid.</p><p>Trade credit is available after PROMEC approves a business account. A quote becomes an order only when every line has a catalogue SKU and the quote is approved.</p><p>Returns open after delivery. PROMEC inspects the part, restocks what can be sold, and refunds the original payment method.</p><p>A VIN is decoded only when the check digit is valid and the make, model, and year match a catalogue variant.</p></Article>;
}

export function PrivacyPage() {
  return <Article title="Privacy"><p>PROMEC stores the account, orders, addresses, and garage you submit. A VIN and plate number are encrypted. Payment card details stay with Paystack.</p><p>Bank-transfer proof is kept so staff can match the payment. Support messages and part requests are kept with the account that sent them.</p></Article>;
}

export function TermsPage() {
  return <Article title="Terms"><p>An order is an offer to buy the listed part at the naira price shown at checkout. PROMEC can refuse an order that fails stock, fitment confirmation, or payment matching.</p><p>A store listing stays in review until PROMEC publishes it. Commission is deducted from the seller’s ledger when the order is paid, and a withdrawal is paid only after PROMEC approves it.</p></Article>;
}

export function DeliveryPage() {
  return <Article title="Delivery and returns"><p>Courier orders use GIG or DHL when those carriers accept the booking. Until a waybill comes back, the shipment waits. Pickup is from the Lagos warehouse.</p><p>A return starts from a delivered order. Refunds for Paystack go back through Paystack. A bank-transfer refund stays pending until PROMEC pays it.</p></Article>;
}
