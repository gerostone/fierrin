import { canonicalProv } from '@/lib/normalize';

// ML filtra por `state` usando un ID propio (ej. "TUxBUENBUGw3M2E1"), no por
// nombre. Resolvemos nombre→ID una vez desde el endpoint público de ubicaciones
// y cacheamos en memoria. Mapeamos por forma canónica de provincia para que
// "Capital Federal" (nombre de ML) caiga en nuestra "CABA".
const LOCATIONS_URL = 'https://api.mercadolibre.com/classified_locations/countries/AR';

interface MlState { id: string; name: string }
interface MlCountry { states?: MlState[] }

let cache: Record<string, string> | null = null;

/** Resetea el cache (solo para tests). */
export function __resetLocationsCache(): void {
  cache = null;
}

/** Devuelve el ID de estado de ML para una provincia, o null si no se resuelve. */
export async function resolveStateId(prov: string, fetchFn: typeof fetch = fetch): Promise<string | null> {
  const want = canonicalProv(prov);
  if (!want) return null;
  if (!cache) {
    const res = await fetchFn(LOCATIONS_URL);
    if (!res.ok) throw new Error(`ML locations ${res.status}`);
    const j = (await res.json()) as MlCountry;
    cache = {};
    for (const s of j.states ?? []) {
      const key = canonicalProv(s.name);
      if (key) cache[key] = s.id;
    }
  }
  return cache[want] ?? null;
}
