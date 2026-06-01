'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { BRANDS, PROVINCES } from '../../../../supabase/seed/reference';

export function FilterBar() {
  const router = useRouter();
  const sp = useSearchParams();
  const [state, setState] = useState({
    brand: sp.get('brand') ?? '', prov: sp.get('prov') ?? '',
    price_min: sp.get('price_min') ?? '', price_max: sp.get('price_max') ?? '',
    km_min: sp.get('km_min') ?? '', km_max: sp.get('km_max') ?? '',
    year_min: sp.get('year_min') ?? '', year_max: sp.get('year_max') ?? '',
  });
  function apply() {
    const p = new URLSearchParams();
    Object.entries(state).forEach(([k, v]) => { if (v) p.set(k, v); });
    router.push(`/buscar?${p.toString()}`);
  }
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setState((s) => ({ ...s, [k]: e.target.value }));
  return (
    <div className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border bg-white p-3 text-sm">
      <select value={state.brand} onChange={set('brand')} className="rounded border px-2 py-1">
        <option value="">Marca</option>
        {BRANDS.map((b) => <option key={b} value={b}>{b}</option>)}
      </select>
      <select value={state.prov} onChange={set('prov')} className="rounded border px-2 py-1">
        <option value="">Provincia</option>
        {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
      <input value={state.price_min} onChange={set('price_min')} placeholder="Precio mín" className="w-24 rounded border px-2 py-1" />
      <input value={state.price_max} onChange={set('price_max')} placeholder="Precio máx" className="w-24 rounded border px-2 py-1" />
      <input value={state.km_min} onChange={set('km_min')} placeholder="Km mín" className="w-20 rounded border px-2 py-1" />
      <input value={state.km_max} onChange={set('km_max')} placeholder="Km máx" className="w-20 rounded border px-2 py-1" />
      <input value={state.year_min} onChange={set('year_min')} placeholder="Año mín" className="w-20 rounded border px-2 py-1" />
      <input value={state.year_max} onChange={set('year_max')} placeholder="Año máx" className="w-20 rounded border px-2 py-1" />
      <button onClick={apply} className="rounded bg-[#1a3a5c] px-4 py-1 text-white">Aplicar</button>
    </div>
  );
}
