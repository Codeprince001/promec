'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { api, unwrap } from '@/lib/api';
import { useDesk } from '@/lib/desk';
import { useSession } from '@/lib/session';

type Make = { id: string; name: string };
type Model = { id: string; name: string; yearFrom: number; yearTo: number };
type Engine = { id: string; code: string; fuelType: string | null; displacementCc: number | null };
type Variant = { id: string; name?: string | null; yearFrom: number; yearTo: number };

export function VehicleFinder() {
  const router = useRouter();
  const setVehicle = useDesk((state) => state.setVehicle);
  const [tab, setTab] = useState<'vehicle' | 'vin' | 'part'>('vehicle');
  const [makes, setMakes] = useState<Make[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [engines, setEngines] = useState<Engine[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [makeId, setMakeId] = useState('');
  const [modelId, setModelId] = useState('');
  const [year, setYear] = useState('');
  const [engineId, setEngineId] = useState('');
  const [variantId, setVariantId] = useState('');
  const [vin, setVin] = useState('');
  const [part, setPart] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    api<{ data: Make[] }>('/vehicles/makes').then((body) => setMakes(unwrap(body))).catch((error: Error) => setMessage(error.message));
  }, []);

  useEffect(() => {
    if (!makeId) return;
    api<{ data: Model[] }>(`/vehicles/models?makeId=${makeId}`).then((body) => setModels(unwrap(body))).catch((error: Error) => setMessage(error.message));
  }, [makeId]);

  useEffect(() => {
    if (!modelId) return;
    api<{ data: number[] }>(`/vehicles/years?modelId=${modelId}`).then((body) => setYears(unwrap(body))).catch((error: Error) => setMessage(error.message));
  }, [modelId]);

  useEffect(() => {
    if (!modelId || !year) return;
    api<{ data: Engine[] }>(`/vehicles/engines?modelId=${modelId}&year=${year}`).then((body) => setEngines(unwrap(body))).catch((error: Error) => setMessage(error.message));
  }, [modelId, year]);

  useEffect(() => {
    if (!modelId || !year) return;
    const engine = engineId ? `&engineId=${engineId}` : '';
    api<{ data: Variant[] }>(`/vehicles/variants?modelId=${modelId}&year=${year}${engine}`).then((body) => setVariants(unwrap(body))).catch((error: Error) => setMessage(error.message));
  }, [modelId, year, engineId]);

  function choose(event: FormEvent) {
    event.preventDefault();
    const make = makes.find((item) => item.id === makeId);
    const model = models.find((item) => item.id === modelId);
    const variant = variants.find((item) => item.id === variantId) ?? variants[0];
    if (!variant || !make || !model) {
      setMessage('Choose a make, model, year, and engine.');
      return;
    }
    setVehicle({ variantId: variant.id, year: Number(year), label: `${year} ${make.name} ${model.name}` });
    router.push('/search');
  }

  async function decode(event: FormEvent) {
    event.preventDefault();
    setMessage('');
    try {
      const body = await api<{ data: { variantId: string | null; make: string; model: string; year: number } }>('/vehicles/decode', {
        method: 'POST',
        body: JSON.stringify({ vin }),
      });
      const decoded = unwrap(body);
      if (!decoded.variantId) {
        setMessage(`${decoded.year} ${decoded.make} ${decoded.model} is not in the PROMEC catalogue yet.`);
        return;
      }
      setVehicle({ variantId: decoded.variantId, year: decoded.year, label: `${decoded.year} ${decoded.make} ${decoded.model}` });
      router.push('/search');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The VIN could not be decoded');
    }
  }

  return (
    <div className="rounded-3xl bg-card p-5 shadow-sm">
      <div className="flex gap-2 text-sm">
        {(['vehicle', 'vin', 'part'] as const).map((item) => (
          <button key={item} type="button" className={tab === item ? 'inline-flex min-h-11 items-center rounded-full bg-navy px-4 text-sm text-white' : 'inline-flex min-h-11 items-center rounded-full px-4 text-sm text-link'} onClick={() => setTab(item)}>
            {item === 'vehicle' ? 'Vehicle' : item === 'vin' ? 'VIN' : 'Part number'}
          </button>
        ))}
      </div>
      {message ? <p className="mt-3 text-sm">{message}</p> : null}
      {tab === 'vehicle' ? (
        <form onSubmit={choose} className="mt-4 grid gap-3 sm:grid-cols-2">
          <Select label="Make" value={makeId} onChange={(value) => { setMakeId(value); setModelId(''); setYear(''); setEngineId(''); setVariantId(''); }} options={makes.map((item) => ({ value: item.id, label: item.name }))} />
          <Select label="Model" value={modelId} onChange={(value) => { setModelId(value); setYear(''); setEngineId(''); setVariantId(''); }} options={models.map((item) => ({ value: item.id, label: item.name }))} />
          <Select label="Year" value={year} onChange={(value) => { setYear(value); setEngineId(''); setVariantId(''); }} options={years.map((item) => ({ value: String(item), label: String(item) }))} />
          <Select label="Engine" value={engineId} onChange={setEngineId} options={engines.map((item) => ({ value: item.id, label: [item.code, item.fuelType, item.displacementCc ? `${item.displacementCc}cc` : ''].filter(Boolean).join(' · ') }))} />
          {variants.length > 1 ? <Select label="Variant" value={variantId} onChange={setVariantId} options={variants.map((item) => ({ value: item.id, label: item.name || `${item.yearFrom}–${item.yearTo}` }))} /> : null}
          <button className="inline-flex min-h-11 items-center justify-center rounded-full bg-brand px-4 font-medium text-white sm:col-span-2" type="submit">Find parts</button>
        </form>
      ) : null}
      {tab === 'vin' ? (
        <form onSubmit={decode} className="mt-4 flex flex-wrap gap-3">
          <input className="control min-w-0 flex-1 uppercase" value={vin} onChange={(event) => setVin(event.target.value)} placeholder="17-character VIN" maxLength={17} />
          <button className="inline-flex min-h-11 items-center justify-center rounded-full bg-brand px-4 font-medium text-white" type="submit">Decode</button>
        </form>
      ) : null}
      {tab === 'part' ? (
        <form onSubmit={(event) => { event.preventDefault(); router.push(`/search?q=${encodeURIComponent(part)}`); }} className="mt-4 flex flex-wrap gap-3">
          <input className="control min-w-0 flex-1" value={part} onChange={(event) => setPart(event.target.value)} placeholder="OEM or aftermarket number" />
          <button className="inline-flex min-h-11 items-center justify-center rounded-full bg-brand px-4 font-medium text-white" type="submit">Search</button>
        </form>
      ) : null}
      <SignedHint />
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="grid gap-1 text-sm">
      {label}
      <select className="control" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Select</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function SignedHint() {
  const token = useSession((state) => state.token);
  if (token) return null;
  return <p className="mt-3 text-xs text-ink/60">A saved garage is available after you <Link className="underline" href="/login">sign in</Link>.</p>;
}
