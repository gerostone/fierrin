import type { Connector, RawListing, NormalizedListing, Segment, Currency } from '@/lib/types';
import { parseKm, parsePrice, normalizeBrand, normalizeProv } from '@/lib/normalize';
import { getValidToken } from '@/lib/ml/oauth';
import { resolveStateId } from './ml-locations';
import { createServiceClient } from '@/lib/supabase/server';

const SITE = 'MLA';
// Categoría "Autos, Motos y Otros". ⚠️ Verificar/ajustar contra una respuesta
// real de /sites/MLA/categories antes de cerrar la tarea (ver plan Task 7).
const CATEGORY = process.env.ML_CATEGORY ?? 'MLA1744';
const SEARCH_URL = `https://api.mercadolibre.com/sites/${SITE}/search`;
const LIMIT = 50;
const MAX_OFFSET = 1000; // tope duro de paginación de la API de ML

interface MlAttr { id: string; value_name?: string }
interface MlItem {
  id?: string | number;
  title?: string;
  price?: number;
  currency_id?: string;
  permalink?: string;
  thumbnail?: string;
  seller?: { car_dealer?: boolean };
  address?: { state_name?: string };
  attributes?: MlAttr[];
}

function attr(item: MlItem, id: string): string | undefined {
  return item.attributes?.find((a) => a.id === id)?.value_name;
}

function normalize(raw: RawListing): NormalizedListing | null {
  const item = raw.raw as MlItem;
  if (!item?.id || !item?.permalink || item?.price == null) return null;
  const currency: Currency | null =
    item.currency_id === 'USD' ? 'USD' : item.currency_id === 'ARS' ? 'ARS' : null;
  const yearStr = attr(item, 'VEHICLE_YEAR');
  return {
    sourceId: 'mercadolibre',
    externalId: String(item.id),
    url: item.permalink,
    title: item.title ?? '',
    brand: normalizeBrand(attr(item, 'BRAND')),
    model: attr(item, 'MODEL') ?? null,
    year: yearStr ? parseInt(yearStr, 10) : null,
    price: parsePrice(item.price),
    currency,
    mileageKm: parseKm(attr(item, 'KILOMETERS') ?? null),
    locationProv: normalizeProv(item.address?.state_name ?? null),
    fuel: attr(item, 'FUEL_TYPE') ?? null,
    transmission: attr(item, 'TRANSMISSION') ?? null,
    sellerType: item.seller?.car_dealer ? 'concesionaria' : 'particular',
    thumbnailUrl: item.thumbnail ?? null,
    raw: item,
  };
}

// Dependencias inyectables (para tests). En producción se resuelven solas.
interface FetchDeps {
  token?: string;
  stateId?: string | null;
  fetchFn?: typeof fetch;
}

async function fetchListings(segment: Segment, deps: FetchDeps = {}): Promise<RawListing[]> {
  // Segmentación elegida: por marca×provincia. El runner itera también por rango
  // de precio (USD), pero ML mezcla precios ARS/USD, así que corremos cada
  // marca×prov una sola vez —en el primer rango— e ignoramos el precio. Los
  // demás rangos devuelven [] para no duplicar avisos ni gastar llamadas.
  if (segment.priceMin !== 0) return [];

  const fetchFn = deps.fetchFn ?? fetch;
  const token = deps.token ?? (await getValidToken(createServiceClient(), fetchFn));
  const stateId = 'stateId' in deps ? deps.stateId : await resolveStateId(segment.prov, fetchFn);

  const out: RawListing[] = [];
  for (let offset = 0; offset < MAX_OFFSET; offset += LIMIT) {
    const p = new URLSearchParams({
      category: CATEGORY,
      q: segment.brand,
      limit: String(LIMIT),
      offset: String(offset),
    });
    if (stateId) p.set('state', stateId);
    const res = await fetchFn(`${SEARCH_URL}?${p}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`ML search ${res.status} @offset ${offset}`);
    const j = (await res.json()) as { results?: MlItem[] };
    const results = j.results ?? [];
    for (const item of results) out.push({ externalId: String(item.id), raw: item });
    if (results.length < LIMIT) break;
  }
  return out;
}

export const mercadolibre: Connector = { id: 'mercadolibre', type: 'api', fetchListings, normalize };
