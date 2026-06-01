export interface SearchFilters {
  q?: string;
  brand?: string[];
  model?: string[];
  yearMin?: number; yearMax?: number;
  priceMin?: number; priceMax?: number;
  currency?: 'ARS' | 'USD';
  kmMin?: number; kmMax?: number;
  prov?: string[];
  fuel?: string;
  transmission?: string;
  sellerType?: 'particular' | 'concesionaria';
  sources?: string[];
  sort?: 'price' | 'year' | 'km' | 'new';
  cursor?: { price: number; id: string };
}

function num(v: string | null): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function parseSearchParams(p: URLSearchParams): SearchFilters {
  const all = (k: string) => p.getAll(k).filter(Boolean);
  const pp = num(p.get('page_price'));
  const pid = p.get('page_id');
  return {
    q: p.get('q') || undefined,
    brand: all('brand').length ? all('brand') : undefined,
    model: all('model').length ? all('model') : undefined,
    yearMin: num(p.get('year_min')), yearMax: num(p.get('year_max')),
    priceMin: num(p.get('price_min')), priceMax: num(p.get('price_max')),
    currency: p.get('currency') === 'USD' ? 'USD' : p.get('currency') === 'ARS' ? 'ARS' : undefined,
    kmMin: num(p.get('km_min')), kmMax: num(p.get('km_max')),
    prov: all('prov').length ? all('prov') : undefined,
    fuel: p.get('fuel') || undefined,
    transmission: p.get('transmission') || undefined,
    sellerType: p.get('seller_type') === 'concesionaria' ? 'concesionaria'
      : p.get('seller_type') === 'particular' ? 'particular' : undefined,
    sources: all('sources').length ? all('sources') : undefined,
    sort: (['price', 'year', 'km', 'new'] as const).find((s) => s === p.get('sort')) ?? 'new',
    cursor: pp != null && pid ? { price: pp, id: pid } : undefined,
  };
}
