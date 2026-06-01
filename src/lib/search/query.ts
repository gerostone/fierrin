import type { SearchFilters } from './filters';

export interface ListingRow {
  id: string; source_id: string; external_id: string; url: string; title: string;
  brand: string | null; model: string | null; year: number | null; price: number | null;
  currency: string | null; mileage_km: number | null; location_prov: string | null;
  fuel: string | null; transmission: string | null; seller_type: string | null;
  thumbnail_url: string | null; dedup_key: string | null; first_seen_at: string;
}

const PAGE_SIZE = 24;

export async function searchListings(db: any, f: SearchFilters): Promise<{ items: ListingRow[]; nextCursor: { price: number; id: string } | null }> {
  let q = db.from('listings').select('*').eq('is_active', true);

  if (f.q) q = q.ilike('title', `%${f.q}%`);
  if (f.brand?.length) q = q.in('brand', f.brand);
  if (f.model?.length) q = q.in('model', f.model);
  if (f.yearMin != null) q = q.gte('year', f.yearMin);
  if (f.yearMax != null) q = q.lte('year', f.yearMax);
  if (f.priceMin != null) q = q.gte('price', f.priceMin);
  if (f.priceMax != null) q = q.lte('price', f.priceMax);
  if (f.currency) q = q.eq('currency', f.currency);
  if (f.kmMin != null) q = q.gte('mileage_km', f.kmMin);
  if (f.kmMax != null) q = q.lte('mileage_km', f.kmMax);
  if (f.prov?.length) q = q.in('location_prov', f.prov);
  if (f.fuel) q = q.eq('fuel', f.fuel);
  if (f.transmission) q = q.eq('transmission', f.transmission);
  if (f.sellerType) q = q.eq('seller_type', f.sellerType);
  if (f.sources?.length) q = q.in('source_id', f.sources);

  // Orden + keyset (cursor sobre (price, id) para el orden por precio)
  if (f.sort === 'year') q = q.order('year', { ascending: false }).order('id');
  else if (f.sort === 'km') q = q.order('mileage_km', { ascending: true }).order('id');
  else if (f.sort === 'new') q = q.order('first_seen_at', { ascending: false }).order('id');
  else {
    q = q.order('price', { ascending: true }).order('id');
    if (f.cursor) q = q.or(`price.gt.${f.cursor.price},and(price.eq.${f.cursor.price},id.gt.${f.cursor.id})`);
  }

  q = q.limit(PAGE_SIZE + 1);
  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const rows: ListingRow[] = data ?? [];
  const hasMore = rows.length > PAGE_SIZE;
  const items = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  const last = items[items.length - 1];
  const nextCursor = hasMore && last?.price != null ? { price: last.price, id: last.id } : null;
  return { items, nextCursor };
}

/** Agrupa por dedup_key para la UI. Items sin key se dejan individuales. */
export function groupByDedup(items: ListingRow[]): ListingRow[][] {
  const groups = new Map<string, ListingRow[]>();
  const singles: ListingRow[][] = [];
  for (const it of items) {
    if (!it.dedup_key) { singles.push([it]); continue; }
    const g = groups.get(it.dedup_key) ?? [];
    g.push(it);
    groups.set(it.dedup_key, g);
  }
  return [...groups.values(), ...singles];
}
