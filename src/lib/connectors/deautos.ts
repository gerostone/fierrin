import { createHash } from 'node:crypto';
import type { Connector, RawListing, NormalizedListing, Segment } from '@/lib/types';
import { normalizeBrand, normalizeProv } from '@/lib/normalize';

const BASE = 'https://www.deautos.com';
const UA = 'FierrinBot/0.1 (+contacto)';

// deautos sirve los avisos como JSON estático fragmentado por origen, no como HTML.
const DATA_FILES = [
  'data/kavak.json',
  'data/kavak2.json',
  'data/mercadolibre.json',
  'data/mercadolibre2.json',
  'data/autocosmos.json',
  'data/extras.json',
  'data/seed_demotores_olx.json',
];

interface DeautosRaw {
  make?: string;
  model?: string;
  year?: number;
  version?: string;
  km?: number;
  price_ars?: number;
  price_usd?: number;
  location?: string;
  transmission?: string;
  fuel?: string;
  color?: string;
  image_url?: string;
  listing_url?: string;
  seller?: string;
}

// listing_url no es único; derivamos un id estable de los campos del aviso.
function externalIdFor(d: DeautosRaw): string {
  const parts = [d.make, d.model, d.year, d.version, d.km, d.location, d.price_usd].join('|');
  return createHash('sha1').update(parts).digest('hex').slice(0, 16);
}

/** Parsea un archivo JSON de avisos de deautos (array de objetos). */
export function parseDeautosJson(text: string): RawListing[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: RawListing[] = [];
  for (const item of data as DeautosRaw[]) {
    if (!item?.listing_url || !item.make) continue;
    out.push({ externalId: externalIdFor(item), raw: item });
  }
  return out;
}

// location viene como "Ciudad, Provincia" (a veces con "(A.M.B.A.)"): tomamos la provincia.
function provinceFromLocation(loc: string | undefined): string | null {
  if (!loc) return null;
  const last = loc.split(',').pop() ?? loc;
  return normalizeProv(last.replace(/\(.*?\)/g, '').trim());
}

function normalize(raw: RawListing): NormalizedListing | null {
  const d = raw.raw as DeautosRaw;
  if (!d?.listing_url || !d.make) return null;
  const title = [d.make, d.model, d.version, d.year].filter(Boolean).join(' ').trim();
  const price = typeof d.price_usd === 'number' ? Math.round(d.price_usd) : null;
  return {
    sourceId: 'deautos',
    externalId: raw.externalId,
    url: d.listing_url,
    title,
    brand: normalizeBrand(d.make),
    model: d.model ?? null,
    year: typeof d.year === 'number' ? d.year : null,
    price,
    currency: price != null ? 'USD' : null,
    mileageKm: typeof d.km === 'number' ? Math.round(d.km) : null,
    locationProv: provinceFromLocation(d.location),
    fuel: d.fuel ?? null,
    transmission: d.transmission ?? null,
    sellerType: null,
    thumbnailUrl: d.image_url || null,
    raw: d,
  };
}

async function fetchListings(segment: Segment, fetchFn: typeof fetch = fetch): Promise<RawListing[]> {
  const settled = await Promise.allSettled(
    DATA_FILES.map(async (file) => {
      const res = await fetchFn(`${BASE}/${file}`, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`deautos ${file} ${res.status}`);
      return parseDeautosJson(await res.text());
    }),
  );
  const all = settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []));

  // El dataset es estático: filtramos al segmento (marca + rango de precio USD)
  // para no devolver los mismos avisos en cada segmento del runner.
  const wantBrand = normalizeBrand(segment.brand);
  return all.filter((r) => {
    const d = r.raw as DeautosRaw;
    if (normalizeBrand(d.make) !== wantBrand) return false;
    const p = typeof d.price_usd === 'number' ? d.price_usd : null;
    return p != null && p >= segment.priceMin && p < segment.priceMax;
  });
}

export const deautos: Connector = { id: 'deautos', type: 'scrape', fetchListings, normalize };
