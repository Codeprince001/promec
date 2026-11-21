'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { saveToken, useSession } from '../../lib/session';
import { naira } from '../../lib/money';
import { addressLine, shipsFrom, type StoreCard, type StoreProduct, type StoreReview } from './types';

export function StoreView({ slug }: { slug: string }) {
  const [store, setStore] = useState<StoreCard | null>(null);
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [reviews, setReviews] = useState<StoreReview[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    Promise.all([
      api<{ data: StoreCard }>(`/vendors/${slug}`),
      api<{ data: StoreProduct[] }>(`/vendors/${slug}/products`),
      api<{ data: StoreReview[] }>(`/vendors/${slug}/reviews`),
    ])
      .then(([shop, catalogue, notes]) => {
        if (!live) return;
        setStore(shop.data);
        setProducts(catalogue.data);
        setReviews(notes.data);
      })
      .catch((reason: Error) => {
        if (live) setError(reason.message);
      });
    return () => {
      live = false;
    };
  }, [slug]);

  return (
    <div>
      {error ? <p className="mx-auto max-w-6xl px-4 py-16 text-lg">{error}</p> : null}
      {!store && !error ? <p className="mx-auto max-w-6xl px-4 py-16">Loading store…</p> : null}
      {store ? (
        <>
          <section className="bg-navy text-white">
            {store.bannerUrl ? <img src={store.bannerUrl} alt="" className="h-48 w-full object-cover md:h-64" /> : <div className="h-36" />}
            <div className="mx-auto flex max-w-6xl items-end gap-5 px-4 pb-8">
              <div className="-mt-12 flex h-24 w-24 items-center justify-center overflow-hidden rounded-2xl border border-white/20 bg-panel">
                {store.logoUrl ? <img src={store.logoUrl} alt="" className="h-full w-full object-cover" /> : <span className="text-2xl font-semibold text-flare">{store.businessName.slice(0, 1)}</span>}
              </div>
              <div className="pb-1">
                <h1 className="display text-4xl">{store.businessName}</h1>
                <p className="mt-1 text-sm text-white/80">
                  {store.ratingCount > 0 ? `${store.ratingAvg} · ${store.ratingCount} ratings` : 'No ratings yet'}
                  {' · '}
                  {shipsFrom(store.fulfilmentMode)}
                </p>
              </div>
            </div>
          </section>
          <main className="mx-auto grid max-w-6xl gap-8 px-4 py-8 lg:grid-cols-[2fr_1fr]">
            <section>
              <h2 className="text-xl font-semibold">Parts from this store</h2>
              {products.length === 0 ? <p className="mt-4 text-ink/70">No published parts yet.</p> : null}
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {products.map((product) => {
                  const price = product.skus[0]?.price.amount;
                  const stock = product.skus[0]?.availability;
                  return (
                    <a key={product.slug} href={`/products/${product.slug}`} className="rounded-2xl bg-card p-4 shadow-sm">
                      {product.media[0] ? <img src={product.media[0].url} alt={product.media[0].alt ?? ''} className="mb-3 h-36 w-full rounded-xl object-cover" /> : null}
                      <p className="font-medium">{product.name}</p>
                      <p className="mt-2 text-accent">{price ? naira(price) : ''}</p>
                      <p className="text-sm text-ink/60">{stock?.qty ? `${stock.qty} in stock` : 'Out of stock'}</p>
                    </a>
                  );
                })}
              </div>
              <h2 className="mt-10 text-xl font-semibold">Ratings</h2>
              <div className="mt-4 space-y-3">
                {reviews.length === 0 ? <p className="text-ink/70">Buyers have not rated this store yet.</p> : null}
                {reviews.map((review) => (
                  <article key={review.id} className="rounded-2xl bg-card p-4">
                    <p className="text-sm font-medium">{review.author} · {review.rating}/5</p>
                    {review.comment ? <p className="mt-2">{review.comment}</p> : null}
                  </article>
                ))}
              </div>
              <ReviewBox slug={slug} onCreated={(review) => setReviews((current) => [review, ...current])} />
            </section>
            <aside className="space-y-4">
              <Info title="About" body={store.description || 'This seller has not added a description yet.'} />
              <Info title="Where they are" body={addressLine(store) || 'Address not published'} extra={store.phone || undefined} />
              <Info title="Store policy" body={store.policies || 'No returns or shipping policy published yet.'} />
            </aside>
          </main>
        </>
      ) : null}
    </div>
  );
}

function Info({ title, body, extra }: { title: string; body: string; extra?: string }) {
  return (
    <section className="rounded-2xl bg-card p-5">
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink/80">{body}</p>
      {extra ? <p className="mt-2 text-sm">{extra}</p> : null}
    </section>
  );
}

function ReviewBox({ slug, onCreated }: { slug: string; onCreated: (review: StoreReview) => void }) {
  const token = useSession((state) => state.token);
  const setToken = useSession((state) => state.setToken);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [orderNo, setOrderNo] = useState('');
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [message, setMessage] = useState('');

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setMessage('');
    try {
      const result = await api<{ data: { accessToken?: string; mfaRequired?: boolean } }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier, password }),
      });
      if (!result.data.accessToken) {
        setMessage('This account needs an authenticator code. Use a customer account to rate a store.');
        return;
      }
      saveToken(result.data.accessToken);
      setToken(result.data.accessToken);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Sign-in failed');
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage('');
    try {
      const result = await api<{ data: { id: string; rating: number; comment: string | null; createdAt: string } }>(`/vendors/${slug}/reviews`, {
        method: 'POST',
        token,
        body: JSON.stringify({ orderNo, rating, comment: comment || undefined }),
      });
      onCreated({ ...result.data, author: 'You' });
      setOrderNo('');
      setComment('');
      setMessage('Rating saved.');
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Rating failed');
    }
  }

  return (
    <section className="mt-6 rounded-2xl bg-card p-5">
      <h2 className="font-semibold">Rate this store</h2>
      <p className="mt-1 text-sm text-ink/70">A rating is available after PROMEC marks your order delivered.</p>
      {message ? <p className="mt-3 text-sm">{message}</p> : null}
      {!token ? (
        <form onSubmit={signIn} className="mt-4 grid gap-3">
          <input className={field} placeholder="Email or phone" value={identifier} onChange={(event) => setIdentifier(event.target.value)} />
          <input className={field} placeholder="Password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          <button className={button} type="submit">Sign in to rate</button>
        </form>
      ) : (
        <form onSubmit={submit} className="mt-4 grid gap-3">
          <input className={field} placeholder="Order number" value={orderNo} onChange={(event) => setOrderNo(event.target.value)} />
          <select className={field} value={rating} onChange={(event) => setRating(Number(event.target.value))}>
            {[5, 4, 3, 2, 1].map((score) => <option key={score} value={score}>{score} star{score === 1 ? '' : 's'}</option>)}
          </select>
          <textarea className={field} placeholder="What should other buyers know?" value={comment} onChange={(event) => setComment(event.target.value)} />
          <button className={button} type="submit">Submit rating</button>
        </form>
      )}
    </section>
  );
}

const field = 'control';
const button = 'inline-flex min-h-11 items-center justify-center rounded-full bg-brand px-5 text-sm font-medium text-white';
