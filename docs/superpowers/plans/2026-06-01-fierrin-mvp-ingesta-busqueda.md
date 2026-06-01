# Fierrin MVP (Ingesta + Búsqueda unificada) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el MVP de Fierrin: un pipeline programado que ingiere autos de ≥2 portales argentinos (MercadoLibre vía API + un portal por scraping), los normaliza y guarda en Supabase, y una app Next.js que permite buscarlos de forma unificada con filtros (incluido rango de km y precio), agrupando posibles duplicados cross-portal.

**Architecture:** Connectors aislados por portal (interfaz común `Connector`) → Normalizer + Dedup (lógica pura) → Ingestion runner (orquesta, upsert, registra corridas) disparado por cron → Supabase Postgres → Search API (Next.js route, keyset pagination) → UI (App Router, barra de filtros superior + grilla de cards, estilo limpio/sobrio). El resto del sistema solo consume `NormalizedListing`; nunca conoce el portal de origen.

**Tech Stack:** Next.js (App Router, TypeScript) · Supabase (Postgres + CLI local) · `@supabase/supabase-js` · Tailwind + shadcn/ui · Vitest (unit + integración) · Playwright (E2E) · Zod (validación de filtros) · cheerio (scraping) · Vercel Cron (scheduler).

**Spec de referencia:** `docs/superpowers/specs/2026-06-01-fierrin-mvp-ingesta-busqueda-design.md`

---

## File Structure

```
fierrin/
├── package.json
├── next.config.ts
├── tsconfig.json
├── vitest.config.ts
├── playwright.config.ts
├── .env.local                      # secrets locales (no commitear)
├── .env.example                    # plantilla commiteable
├── supabase/
│   ├── config.toml
│   ├── migrations/
│   │   ├── 0001_init_schema.sql    # sources, listings, ingest_runs + índices
│   │   └── 0002_seed_sources.sql   # filas de sources
│   └── seed/
│       └── reference.ts            # marcas y provincias para segmentación
├── src/
│   ├── lib/
│   │   ├── types.ts                # NormalizedListing, RawListing, Segment, Connector
│   │   ├── normalize.ts            # normalize(sourceId, raw) -> NormalizedListing
│   │   ├── dedup.ts                # computeDedupKey(norm)
│   │   ├── supabase/
│   │   │   ├── server.ts           # cliente service-role (ingesta/API server)
│   │   │   └── browser.ts          # cliente anon (no usado en MVP, dejado listo)
│   │   ├── connectors/
│   │   │   ├── index.ts            # registry: lista de connectors habilitados
│   │   │   ├── mercadolibre.ts     # Connector API
│   │   │   └── deautos.ts          # Connector scraping
│   │   ├── ingest/
│   │   │   ├── segments.ts         # generateSegments(refData) -> Segment[]
│   │   │   └── runner.ts           # runIngestion(deps) -> resumen
│   │   └── search/
│   │       ├── filters.ts          # schema Zod + parseSearchParams
│   │       └── query.ts            # buildSearchQuery + searchListings(db, filters)
│   └── app/
│       ├── layout.tsx
│       ├── globals.css
│       ├── page.tsx                # landing -> /buscar
│       ├── buscar/
│       │   ├── page.tsx            # server component: lee filtros, llama searchListings
│       │   └── _components/
│       │       ├── filter-bar.tsx  # client: barra superior de filtros
│       │       ├── results-grid.tsx
│       │       └── listing-card.tsx# card + agrupación "También en N portales"
│       ├── aviso/[id]/page.tsx     # detalle
│       └── api/
│           ├── search/route.ts     # GET búsqueda (JSON)
│           └── ingest/run/route.ts # POST disparo de ingesta (protegido por secret)
├── tests/
│   ├── fixtures/
│   │   ├── ml-search-sample.json   # respuesta real capturada de ML
│   │   └── deautos-listing.html    # HTML real capturado de deautos
│   └── e2e/
│       └── buscar.spec.ts          # Playwright happy-path
└── vercel.json                     # cron config
```

Cada archivo de `src/lib` tiene una sola responsabilidad y se testea aislado. `normalize.ts`, `dedup.ts`, `segments.ts`, `search/filters.ts` y `search/query.ts` son lógica pura o casi pura (fáciles de TDD). Los connectors aíslan toda la dependencia externa por portal.

---

## Phase 0 — Scaffolding

### Task 1: Inicializar el proyecto Next.js + herramientas

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `.env.example`, `.gitignore` (ya existe — actualizar)

- [ ] **Step 1: Crear la app Next.js con TypeScript y Tailwind**

Run (en la raíz `/Users/Gero/Documents/Fierrin`, que ya tiene git y archivos):
```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --no-turbopack
```
Cuando pregunte por sobrescribir archivos existentes (`.gitignore`, `docs/`), elegir **no** sobrescribir lo que no sea de Next. Si el comando rechaza el directorio no vacío, crear en subcarpeta temporal y mover, o usar `--use-npm` y aceptar el merge. Expected: estructura `src/app/` creada.

- [ ] **Step 2: Instalar dependencias del proyecto**

Run:
```bash
npm install @supabase/supabase-js zod cheerio
npm install -D vitest @vitejs/plugin-react vite-tsconfig-paths @playwright/test
npx playwright install chromium
```
Expected: dependencias en `package.json`, sin errores.

- [ ] **Step 3: Inicializar shadcn/ui**

Run:
```bash
npx shadcn@latest init -d
npx shadcn@latest add button input select badge card
```
Expected: `components.json` creado y componentes en `src/components/ui/`.

- [ ] **Step 4: Crear `.env.example`**

Crear `.env.example`:
```
# Supabase (local dev usa los valores que imprime `supabase start`)
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# MercadoLibre API (client credentials)
ML_CLIENT_ID=
ML_CLIENT_SECRET=

# Secret para proteger el endpoint de ingesta
INGEST_SECRET=dev-secret-change-me
```
Copiar a `.env.local` y completar tras Task 2. Confirmar que `.env*.local` está en `.gitignore` (ya lo está).

- [ ] **Step 5: Verificar que el proyecto levanta**

Run: `npm run dev` (luego cortar con Ctrl-C).
Expected: Next arranca en `http://localhost:3000` sin errores de compilación.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app with Tailwind, shadcn, test tooling"
```

---

### Task 2: Configurar Supabase local y el esquema

**Files:**
- Create: `supabase/config.toml` (generado), `supabase/migrations/0001_init_schema.sql`, `supabase/migrations/0002_seed_sources.sql`

- [ ] **Step 1: Inicializar y arrancar Supabase local**

Run:
```bash
npx supabase init
npx supabase start
```
Expected: imprime `API URL`, `anon key`, `service_role key`. Copiar esos valores a `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`). Requiere Docker corriendo.

- [ ] **Step 2: Crear la migración del esquema**

Crear `supabase/migrations/0001_init_schema.sql`:
```sql
create table sources (
  id      text primary key,
  name    text not null,
  type    text not null check (type in ('api','scrape')),
  enabled boolean not null default true
);

create table listings (
  id             uuid primary key default gen_random_uuid(),
  source_id      text not null references sources(id),
  external_id    text not null,
  url            text not null,
  title          text not null,
  brand          text,
  model          text,
  year           int,
  price          numeric,
  currency       text check (currency in ('ARS','USD')),
  mileage_km     int,
  location_prov  text,
  fuel           text,
  transmission   text,
  seller_type    text check (seller_type in ('particular','concesionaria')),
  thumbnail_url  text,
  raw            jsonb,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  is_active      boolean not null default true,
  dedup_key      text,
  unique (source_id, external_id)
);

create index idx_listings_brand     on listings (brand);
create index idx_listings_model     on listings (model);
create index idx_listings_year      on listings (year);
create index idx_listings_price     on listings (price);
create index idx_listings_mileage   on listings (mileage_km);
create index idx_listings_prov      on listings (location_prov);
create index idx_listings_dedup     on listings (dedup_key);
create index idx_listings_active    on listings (is_active);
create index idx_listings_keyset    on listings (price, id);

create table ingest_runs (
  id           uuid primary key default gen_random_uuid(),
  source_id    text not null,
  segment      text not null,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text not null check (status in ('running','ok','partial','error')),
  fetched      int not null default 0,
  upserted     int not null default 0,
  errors       int not null default 0,
  error_detail text
);
```

- [ ] **Step 3: Crear el seed de sources**

Crear `supabase/migrations/0002_seed_sources.sql`:
```sql
insert into sources (id, name, type, enabled) values
  ('mercadolibre', 'MercadoLibre', 'api', true),
  ('deautos',      'deautos.com',  'scrape', true)
on conflict (id) do nothing;
```

- [ ] **Step 4: Aplicar las migraciones**

Run:
```bash
npx supabase db reset
```
Expected: aplica `0001` y `0002` sin error; `select * from sources;` (vía `npx supabase db query "select id from sources"` o el Studio en `http://127.0.0.1:54323`) muestra 2 filas.

- [ ] **Step 5: Crear los clientes de Supabase**

Crear `src/lib/supabase/server.ts`:
```ts
import { createClient } from '@supabase/supabase-js';

export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Faltan env vars de Supabase server');
  return createClient(url, key, { auth: { persistSession: false } });
}
```

- [ ] **Step 6: Commit**

```bash
git add supabase/ src/lib/supabase/
git commit -m "feat: add Supabase schema, sources seed, and server client"
```

---

## Phase 1 — Tipos y lógica pura (TDD)

### Task 3: Definir los tipos centrales

**Files:**
- Create: `src/lib/types.ts`

- [ ] **Step 1: Escribir los tipos**

Crear `src/lib/types.ts`:
```ts
export type Currency = 'ARS' | 'USD';
export type SellerType = 'particular' | 'concesionaria';

/** Listing crudo tal como lo devuelve un connector, sin normalizar. */
export interface RawListing {
  externalId: string;
  raw: unknown;          // payload original del portal
}

/** Listing normalizado: única forma que conoce el resto del sistema. */
export interface NormalizedListing {
  sourceId: string;
  externalId: string;
  url: string;
  title: string;
  brand: string | null;
  model: string | null;
  year: number | null;
  price: number | null;
  currency: Currency | null;
  mileageKm: number | null;
  locationProv: string | null;
  fuel: string | null;
  transmission: string | null;
  sellerType: SellerType | null;
  thumbnailUrl: string | null;
  raw: unknown;
  dedupKey?: string;
}

/** Un segmento del catálogo a recorrer (marca × provincia × rango de precio). */
export interface Segment {
  brand: string;
  prov: string;
  priceMin: number;
  priceMax: number;
}

export interface Connector {
  id: string;
  type: 'api' | 'scrape';
  /** Devuelve listings crudos del segmento. Lanza si el fetch falla irrecuperablemente. */
  fetchListings(segment: Segment): Promise<RawListing[]>;
  /** Normaliza un raw de ESTE portal. Devuelve null si es inválido/descartable. */
  normalize(raw: RawListing): NormalizedListing | null;
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: add core domain types"
```

---

### Task 4: Helpers de normalización (TDD)

Los connectors comparten utilidades de limpieza. Las extraemos y testeamos aisladas.

**Files:**
- Create: `src/lib/normalize.ts`, `tests/normalize.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

Crear `tests/normalize.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseKm, parsePrice, normalizeBrand, normalizeProv } from '@/lib/normalize';

describe('parseKm', () => {
  it('parsea "80.000 km"', () => expect(parseKm('80.000 km')).toBe(80000));
  it('parsea número crudo', () => expect(parseKm(80000)).toBe(80000));
  it('devuelve null si no hay dígitos', () => expect(parseKm('s/d')).toBeNull());
});

describe('parsePrice', () => {
  it('parsea "$ 14.500"', () => expect(parsePrice('$ 14.500')).toBe(14500));
  it('devuelve null para vacío', () => expect(parsePrice('')).toBeNull());
});

describe('normalizeBrand', () => {
  it('mapea alias VW a Volkswagen', () => expect(normalizeBrand('vw')).toBe('Volkswagen'));
  it('capitaliza marca desconocida', () => expect(normalizeBrand('renault')).toBe('Renault'));
});

describe('normalizeProv', () => {
  it('mapea Capital Federal a CABA', () => expect(normalizeProv('Capital Federal')).toBe('CABA'));
  it('devuelve la provincia tal cual si ya es canónica', () => expect(normalizeProv('Córdoba')).toBe('Córdoba'));
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run tests/normalize.test.ts`
Expected: FAIL — módulo/exports no existen.

- [ ] **Step 3: Implementar los helpers**

Crear `src/lib/normalize.ts`:
```ts
const BRAND_ALIASES: Record<string, string> = {
  vw: 'Volkswagen',
  volkswagen: 'Volkswagen',
  chevy: 'Chevrolet',
};

const PROV_ALIASES: Record<string, string> = {
  'capital federal': 'CABA',
  'ciudad autónoma de buenos aires': 'CABA',
  caba: 'CABA',
};

export function parseKm(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : null;
  const digits = v.replace(/[^\d]/g, '');
  return digits ? parseInt(digits, 10) : null;
}

export function parsePrice(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const digits = v.replace(/[^\d]/g, '');
  return digits ? parseInt(digits, 10) : null;
}

export function normalizeBrand(b: string | null | undefined): string | null {
  if (!b) return null;
  const key = b.trim().toLowerCase();
  if (BRAND_ALIASES[key]) return BRAND_ALIASES[key];
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function normalizeProv(p: string | null | undefined): string | null {
  if (!p) return null;
  const key = p.trim().toLowerCase();
  return PROV_ALIASES[key] ?? p.trim();
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `npx vitest run tests/normalize.test.ts`
Expected: PASS (10 asserts).

- [ ] **Step 5: Commit**

```bash
git add src/lib/normalize.ts tests/normalize.test.ts
git commit -m "feat: add normalization helpers with tests"
```

---

### Task 5: Cálculo de `dedup_key` (TDD)

**Files:**
- Create: `src/lib/dedup.ts`, `tests/dedup.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

Crear `tests/dedup.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { computeDedupKey } from '@/lib/dedup';
import type { NormalizedListing } from '@/lib/types';

const base: NormalizedListing = {
  sourceId: 'mercadolibre', externalId: '1', url: 'u', title: 't',
  brand: 'Volkswagen', model: 'Golf', year: 2018, price: 14500, currency: 'USD',
  mileageKm: 80000, locationProv: 'CABA', fuel: 'Nafta', transmission: 'Manual',
  sellerType: 'particular', thumbnailUrl: null, raw: {},
};

describe('computeDedupKey', () => {
  it('mismo auto en otro portal => misma key', () => {
    const a = computeDedupKey(base);
    const b = computeDedupKey({ ...base, sourceId: 'deautos', externalId: '999', url: 'otra' });
    expect(b).toBe(a);
  });

  it('km dentro del mismo bucket (5000) => misma key', () => {
    const a = computeDedupKey(base);
    const b = computeDedupKey({ ...base, mileageKm: 82000 });
    expect(b).toBe(a);
  });

  it('precio en otro bucket (10%) => key distinta', () => {
    const a = computeDedupKey(base);
    const b = computeDedupKey({ ...base, price: 20000 });
    expect(b).not.toBe(a);
  });

  it('modelo distinto => key distinta', () => {
    expect(computeDedupKey({ ...base, model: 'Polo' })).not.toBe(computeDedupKey(base));
  });

  it('campos clave nulos => key null', () => {
    expect(computeDedupKey({ ...base, brand: null })).toBeNull();
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run tests/dedup.test.ts`
Expected: FAIL — `computeDedupKey` no existe.

- [ ] **Step 3: Implementar**

Crear `src/lib/dedup.ts`:
```ts
import { createHash } from 'node:crypto';
import type { NormalizedListing } from '@/lib/types';

const KM_BUCKET = 5000;
const PRICE_BUCKET_RATIO = 0.1; // buckets relativos del 10%

/** Agrupa posibles duplicados cross-portal. null si falta info clave. */
export function computeDedupKey(l: NormalizedListing): string | null {
  if (!l.brand || !l.model || l.year == null || l.price == null || l.mileageKm == null || !l.locationProv) {
    return null;
  }
  const kmBucket = Math.round(l.mileageKm / KM_BUCKET);
  const priceBucket = Math.round(Math.log(l.price) / Math.log(1 + PRICE_BUCKET_RATIO));
  const parts = [l.brand, l.model, l.year, kmBucket, priceBucket, l.locationProv]
    .join('|')
    .toLowerCase();
  return createHash('sha1').update(parts).digest('hex').slice(0, 16);
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `npx vitest run tests/dedup.test.ts`
Expected: PASS (5 asserts). Nota: el bucket de precio logarítmico hace que 14500 y 20000 caigan en buckets distintos (≥10% de separación) y 14500 vs ~15000 en el mismo.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dedup.ts tests/dedup.test.ts
git commit -m "feat: add cross-portal dedup key with tests"
```

---

### Task 6: Generación de segmentos (TDD)

**Files:**
- Create: `src/lib/ingest/segments.ts`, `supabase/seed/reference.ts`, `tests/segments.test.ts`

- [ ] **Step 1: Crear los datos de referencia**

Crear `supabase/seed/reference.ts`:
```ts
export const BRANDS = ['Volkswagen', 'Toyota', 'Ford', 'Chevrolet', 'Renault', 'Peugeot', 'Fiat'];
export const PROVINCES = ['CABA', 'Buenos Aires', 'Córdoba', 'Santa Fe', 'Mendoza'];
// Rangos de precio en USD para subdividir y no topar el límite de paginación.
export const PRICE_RANGES: Array<[number, number]> = [
  [0, 8000], [8000, 15000], [15000, 25000], [25000, 1_000_000],
];
```

- [ ] **Step 2: Escribir los tests que fallan**

Crear `tests/segments.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { generateSegments } from '@/lib/ingest/segments';

describe('generateSegments', () => {
  it('produce brand × prov × priceRange', () => {
    const segs = generateSegments({
      brands: ['Volkswagen', 'Ford'],
      provinces: ['CABA'],
      priceRanges: [[0, 8000], [8000, 15000]],
    });
    expect(segs).toHaveLength(2 * 1 * 2);
    expect(segs).toContainEqual({ brand: 'Volkswagen', prov: 'CABA', priceMin: 0, priceMax: 8000 });
  });

  it('cada segmento tiene priceMin < priceMax', () => {
    const segs = generateSegments({ brands: ['Toyota'], provinces: ['Córdoba'], priceRanges: [[8000, 15000]] });
    for (const s of segs) expect(s.priceMin).toBeLessThan(s.priceMax);
  });
});
```

- [ ] **Step 3: Correr y ver que falla**

Run: `npx vitest run tests/segments.test.ts`
Expected: FAIL — `generateSegments` no existe.

- [ ] **Step 4: Implementar**

Crear `src/lib/ingest/segments.ts`:
```ts
import type { Segment } from '@/lib/types';

interface RefData {
  brands: string[];
  provinces: string[];
  priceRanges: Array<[number, number]>;
}

export function generateSegments(ref: RefData): Segment[] {
  const out: Segment[] = [];
  for (const brand of ref.brands) {
    for (const prov of ref.provinces) {
      for (const [priceMin, priceMax] of ref.priceRanges) {
        out.push({ brand, prov, priceMin, priceMax });
      }
    }
  }
  return out;
}
```

- [ ] **Step 5: Correr y ver que pasa**

Run: `npx vitest run tests/segments.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ingest/segments.ts supabase/seed/reference.ts tests/segments.test.ts
git commit -m "feat: add catalog segment generation with tests"
```

---

## Phase 2 — Connectors

### Task 7: Connector MercadoLibre (API)

> ⚠️ **Verificación obligatoria antes de codear el parseo.** Los IDs de categoría/atributos y el requisito de OAuth de la API de ML pueden diferir de lo asumido. El Step 1 captura una respuesta real a un fixture; el parseo se escribe contra ESE fixture, no contra supuestos.

**Files:**
- Create: `tests/fixtures/ml-search-sample.json`, `src/lib/connectors/mercadolibre.ts`, `tests/connectors/mercadolibre.test.ts`

- [ ] **Step 1: Capturar una respuesta real de ML a un fixture**

Conseguir un token de aplicación (client credentials) en https://developers.mercadolibre.com.ar y exportar `ML_CLIENT_ID`/`ML_CLIENT_SECRET` en `.env.local`. Obtener token:
```bash
curl -s -X POST https://api.mercadolibre.com/oauth/token \
  -d grant_type=client_credentials -d client_id=$ML_CLIENT_ID -d client_secret=$ML_CLIENT_SECRET
```
Con el `access_token`, capturar una búsqueda de autos en Argentina (sitio `MLA`). Verificar el ID de la categoría "Autos, Motos y Otros / Autos y Camionetas" con `https://api.mercadolibre.com/sites/MLA/categories` y usarlo:
```bash
curl -s "https://api.mercadolibre.com/sites/MLA/search?category=<CATEGORY_ID>&limit=5" \
  -H "Authorization: Bearer <access_token>" > tests/fixtures/ml-search-sample.json
```
Inspeccionar el JSON: confirmar dónde vienen `id`, `title`, `price`, `currency_id`, `permalink`, `thumbnail`, `seller.car_dealer` (o equivalente) y los `attributes` con `id` ∈ {`BRAND`, `MODEL`, `VEHICLE_YEAR`, `KILOMETERS`, `FUEL_TYPE`, `TRANSMISSION`} y `address.state_name`. **Ajustar los nombres de campo del Step 4 a lo que muestre el fixture.**

- [ ] **Step 2: Escribir el test que falla (contra el fixture)**

Crear `tests/connectors/mercadolibre.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { mercadolibre } from '@/lib/connectors/mercadolibre';
import type { RawListing } from '@/lib/types';

const sample = JSON.parse(readFileSync('tests/fixtures/ml-search-sample.json', 'utf8'));

describe('mercadolibre.normalize', () => {
  it('normaliza el primer item del fixture', () => {
    const item = sample.results[0];
    const raw: RawListing = { externalId: String(item.id), raw: item };
    const n = mercadolibre.normalize(raw)!;
    expect(n.sourceId).toBe('mercadolibre');
    expect(n.externalId).toBe(String(item.id));
    expect(n.url).toBe(item.permalink);
    expect(n.title).toBe(item.title);
    expect(n.price).toBe(item.price);
    expect(['ARS', 'USD']).toContain(n.currency);
    expect(n.year == null || n.year > 1950).toBe(true);
    expect(n.mileageKm == null || n.mileageKm >= 0).toBe(true);
  });
});
```

- [ ] **Step 3: Correr y ver que falla**

Run: `npx vitest run tests/connectors/mercadolibre.test.ts`
Expected: FAIL — `mercadolibre` no existe.

- [ ] **Step 4: Implementar el connector**

Crear `src/lib/connectors/mercadolibre.ts` (ajustar IDs de atributo y category según el fixture del Step 1):
```ts
import type { Connector, RawListing, NormalizedListing, Segment, Currency } from '@/lib/types';
import { parseKm, parsePrice, normalizeBrand, normalizeProv } from '@/lib/normalize';

const SITE = 'MLA';
const CATEGORY = process.env.ML_CATEGORY ?? 'MLA1744'; // verificar/ajustar con el fixture
const TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';
const SEARCH_URL = `https://api.mercadolibre.com/sites/${SITE}/search`;

let cachedToken: { value: string; exp: number } | null = null;

async function getToken(fetchFn = fetch): Promise<string> {
  if (cachedToken && cachedToken.exp > Date.now() + 30_000) return cachedToken.value;
  const res = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.ML_CLIENT_ID ?? '',
      client_secret: process.env.ML_CLIENT_SECRET ?? '',
    }),
  });
  if (!res.ok) throw new Error(`ML token error ${res.status}`);
  const j = await res.json();
  cachedToken = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return cachedToken.value;
}

function attr(item: any, id: string): string | undefined {
  return item.attributes?.find((a: any) => a.id === id)?.value_name;
}

function normalize(raw: RawListing): NormalizedListing | null {
  const item = raw.raw as any;
  if (!item?.id || !item?.permalink || item?.price == null) return null;
  const currency: Currency | null = item.currency_id === 'USD' ? 'USD' : item.currency_id === 'ARS' ? 'ARS' : null;
  const yearStr = attr(item, 'VEHICLE_YEAR');
  return {
    sourceId: 'mercadolibre',
    externalId: String(item.id),
    url: item.permalink,
    title: item.title,
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

async function fetchListings(segment: Segment, fetchFn = fetch): Promise<RawListing[]> {
  const token = await getToken(fetchFn);
  const out: RawListing[] = [];
  const LIMIT = 50;
  for (let offset = 0; offset < 1000; offset += LIMIT) {
    const url = `${SEARCH_URL}?category=${CATEGORY}&q=${encodeURIComponent(segment.brand)}`
      + `&state=${encodeURIComponent(segment.prov)}`
      + `&price=${segment.priceMin}-${segment.priceMax}&limit=${LIMIT}&offset=${offset}`;
    const res = await fetchFn(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`ML search ${res.status} @offset ${offset}`);
    const j = await res.json();
    const results = j.results ?? [];
    for (const item of results) out.push({ externalId: String(item.id), raw: item });
    if (results.length < LIMIT) break;
  }
  return out;
}

export const mercadolibre: Connector = { id: 'mercadolibre', type: 'api', fetchListings, normalize };
```

- [ ] **Step 5: Correr y ver que pasa**

Run: `npx vitest run tests/connectors/mercadolibre.test.ts`
Expected: PASS. Si falla por nombres de campo, ajustar el mapeo del Step 4 al fixture real (NO tocar el test salvo que el supuesto del assert sea incorrecto).

- [ ] **Step 6: Commit**

```bash
git add src/lib/connectors/mercadolibre.ts tests/connectors/mercadolibre.test.ts tests/fixtures/ml-search-sample.json
git commit -m "feat: add MercadoLibre API connector with fixture test"
```

---

### Task 8: Connector deautos (scraping)

> ⚠️ Mismo principio: capturar HTML real a un fixture y escribir el parseo contra él. Antes de habilitar en producción, verificar `robots.txt` de deautos y la postura de ToS (ver spec, sección de riesgo).

**Files:**
- Create: `tests/fixtures/deautos-listing.html`, `src/lib/connectors/deautos.ts`, `tests/connectors/deautos.test.ts`

- [ ] **Step 1: Capturar HTML real de un listado de deautos**

Run (revisar primero `https://www.deautos.com/robots.txt`):
```bash
curl -s -A "FierrinBot/0.1 (+contacto)" "https://www.deautos.com/autos-usados" > tests/fixtures/deautos-listing.html
```
Inspeccionar el HTML y anotar los selectores reales de cada card (contenedor, título, precio, año, km, ubicación, link). **Ajustar los selectores del Step 4 a lo observado.**

- [ ] **Step 2: Escribir el test que falla**

Crear `tests/connectors/deautos.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseDeautosHtml, deautos } from '@/lib/connectors/deautos';

const html = readFileSync('tests/fixtures/deautos-listing.html', 'utf8');

describe('parseDeautosHtml', () => {
  it('extrae al menos un listing con campos clave', () => {
    const raws = parseDeautosHtml(html);
    expect(raws.length).toBeGreaterThan(0);
    const n = deautos.normalize(raws[0])!;
    expect(n.sourceId).toBe('deautos');
    expect(n.externalId).toBeTruthy();
    expect(n.url).toMatch(/^https?:\/\//);
    expect(n.title).toBeTruthy();
  });
});
```

- [ ] **Step 3: Correr y ver que falla**

Run: `npx vitest run tests/connectors/deautos.test.ts`
Expected: FAIL — módulo no existe.

- [ ] **Step 4: Implementar (ajustar selectores al fixture)**

Crear `src/lib/connectors/deautos.ts`:
```ts
import * as cheerio from 'cheerio';
import type { Connector, RawListing, NormalizedListing, Segment } from '@/lib/types';
import { parseKm, parsePrice, normalizeBrand, normalizeProv } from '@/lib/normalize';

const BASE = 'https://www.deautos.com';

interface DeautosRaw {
  externalId: string;
  url: string;
  title: string;
  priceText: string;
  year: string;
  kmText: string;
  prov: string;
  thumb: string | null;
}

/** Parsea el HTML del listado. SELECTORES: ajustar a tests/fixtures/deautos-listing.html. */
export function parseDeautosHtml(html: string): RawListing[] {
  const $ = cheerio.load(html);
  const out: RawListing[] = [];
  $('[data-testid="result-card"], article.listing-card').each((_, el) => {
    const card = $(el);
    const href = card.find('a').first().attr('href') ?? '';
    const url = href.startsWith('http') ? href : BASE + href;
    const externalId = url.split('/').filter(Boolean).pop() ?? url;
    const data: DeautosRaw = {
      externalId,
      url,
      title: card.find('.listing-title, h2').first().text().trim(),
      priceText: card.find('.listing-price, [data-testid="price"]').first().text().trim(),
      year: card.find('.listing-year, [data-testid="year"]').first().text().trim(),
      kmText: card.find('.listing-km, [data-testid="km"]').first().text().trim(),
      prov: card.find('.listing-location, [data-testid="location"]').first().text().trim(),
      thumb: card.find('img').first().attr('src') ?? null,
    };
    if (data.url && data.title) out.push({ externalId, raw: data });
  });
  return out;
}

function normalize(raw: RawListing): NormalizedListing | null {
  const d = raw.raw as DeautosRaw;
  if (!d?.url || !d?.title) return null;
  const yearNum = parseInt((d.year.match(/\d{4}/) ?? [''])[0], 10);
  // marca/modelo: primera y segunda palabra del título (heurística MVP)
  const [brandWord, ...rest] = d.title.split(/\s+/);
  return {
    sourceId: 'deautos',
    externalId: d.externalId,
    url: d.url,
    title: d.title,
    brand: normalizeBrand(brandWord),
    model: rest[0] ?? null,
    year: Number.isFinite(yearNum) ? yearNum : null,
    price: parsePrice(d.priceText),
    currency: /u\$|usd/i.test(d.priceText) ? 'USD' : 'ARS',
    mileageKm: parseKm(d.kmText),
    locationProv: normalizeProv(d.prov),
    fuel: null,
    transmission: null,
    sellerType: null,
    thumbnailUrl: d.thumb,
    raw: d,
  };
}

async function fetchListings(segment: Segment, fetchFn = fetch): Promise<RawListing[]> {
  const url = `${BASE}/autos-usados/${encodeURIComponent(segment.brand.toLowerCase())}`;
  const res = await fetchFn(url, { headers: { 'User-Agent': 'FierrinBot/0.1 (+contacto)' } });
  if (!res.ok) throw new Error(`deautos ${res.status}`);
  return parseDeautosHtml(await res.text());
}

export const deautos: Connector = { id: 'deautos', type: 'scrape', fetchListings, normalize };
```

- [ ] **Step 5: Correr y ver que pasa**

Run: `npx vitest run tests/connectors/deautos.test.ts`
Expected: PASS. Si falla, ajustar selectores del Step 4 al HTML real del fixture.

- [ ] **Step 6: Registrar los connectors**

Crear `src/lib/connectors/index.ts`:
```ts
import type { Connector } from '@/lib/types';
import { mercadolibre } from './mercadolibre';
import { deautos } from './deautos';

export const CONNECTORS: Record<string, Connector> = {
  mercadolibre,
  deautos,
};
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/connectors/ tests/connectors/deautos.test.ts tests/fixtures/deautos-listing.html
git commit -m "feat: add deautos scraping connector and connector registry"
```

---

## Phase 3 — Ingestion runner

### Task 9: Runner con resiliencia (integración)

**Files:**
- Create: `src/lib/ingest/runner.ts`, `tests/ingest/runner.test.ts`

- [ ] **Step 1: Escribir el test de integración que falla**

El runner recibe sus dependencias inyectadas (connectors, cliente DB, lista de segmentos) para testearlo con dobles. Crear `tests/ingest/runner.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { runIngestion } from '@/lib/ingest/runner';
import type { Connector, RawListing, NormalizedListing, Segment } from '@/lib/types';

const seg: Segment = { brand: 'Volkswagen', prov: 'CABA', priceMin: 0, priceMax: 8000 };

function fakeListing(id: string): NormalizedListing {
  return {
    sourceId: 'x', externalId: id, url: 'u' + id, title: 'Golf', brand: 'Volkswagen',
    model: 'Golf', year: 2018, price: 7000, currency: 'USD', mileageKm: 80000,
    locationProv: 'CABA', fuel: null, transmission: null, sellerType: 'particular',
    thumbnailUrl: null, raw: {},
  };
}

function makeConnector(id: string, behavior: 'ok' | 'throw'): Connector {
  return {
    id, type: 'api',
    fetchListings: async () => {
      if (behavior === 'throw') throw new Error('portal caído');
      return [{ externalId: '1', raw: {} }] as RawListing[];
    },
    normalize: () => ({ ...fakeListing('1'), sourceId: id }),
  };
}

// Doble del cliente DB: registra upserts y runs en memoria.
function makeFakeDb() {
  const upserts: any[] = [];
  const runs: any[] = [];
  return {
    upserts, runs,
    from(table: string) {
      if (table === 'ingest_runs') {
        return {
          insert: (row: any) => { runs.push({ ...row }); return { select: () => ({ single: async () => ({ data: { id: 'run-' + runs.length }, error: null }) }) }; },
          update: (patch: any) => ({ eq: async () => { Object.assign(runs[runs.length - 1], patch); return { error: null }; } }),
        };
      }
      if (table === 'listings') {
        return {
          upsert: async (rows: any[]) => { upserts.push(...rows); return { error: null }; },
          update: () => ({ eq: () => ({ eq: () => ({ not: () => ({ in: async () => ({ error: null }) }) }) }) }),
        };
      }
      throw new Error('tabla inesperada ' + table);
    },
  };
}

describe('runIngestion', () => {
  it('un portal que falla no frena a los demás', async () => {
    const db = makeFakeDb();
    const summary = await runIngestion({
      db: db as any,
      connectors: [makeConnector('mercadolibre', 'throw'), makeConnector('deautos', 'ok')],
      segments: [seg],
    });
    expect(summary.errorRuns).toBe(1);
    expect(summary.okRuns).toBe(1);
    expect(db.upserts.length).toBe(1);            // solo el connector que anduvo
    expect(db.upserts[0].dedup_key).toBeTruthy(); // se calculó la key
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run tests/ingest/runner.test.ts`
Expected: FAIL — `runIngestion` no existe.

- [ ] **Step 3: Implementar el runner**

Crear `src/lib/ingest/runner.ts`:
```ts
import type { Connector, Segment, NormalizedListing } from '@/lib/types';
import { computeDedupKey } from '@/lib/dedup';

interface RunDeps {
  db: any; // cliente Supabase (service role) o doble compatible
  connectors: Connector[];
  segments: Segment[];
}

interface RunSummary {
  okRuns: number;
  partialRuns: number;
  errorRuns: number;
  totalUpserted: number;
}

function toRow(n: NormalizedListing) {
  return {
    source_id: n.sourceId, external_id: n.externalId, url: n.url, title: n.title,
    brand: n.brand, model: n.model, year: n.year, price: n.price, currency: n.currency,
    mileage_km: n.mileageKm, location_prov: n.locationProv, fuel: n.fuel,
    transmission: n.transmission, seller_type: n.sellerType, thumbnail_url: n.thumbnailUrl,
    raw: n.raw, dedup_key: computeDedupKey(n), last_seen_at: new Date().toISOString(),
    is_active: true,
  };
}

export async function runIngestion(deps: RunDeps): Promise<RunSummary> {
  const summary: RunSummary = { okRuns: 0, partialRuns: 0, errorRuns: 0, totalUpserted: 0 };

  for (const connector of deps.connectors) {
    for (const segment of deps.segments) {
      const segLabel = `brand=${segment.brand}&prov=${segment.prov}&price=${segment.priceMin}-${segment.priceMax}`;
      const { data: run } = await deps.db.from('ingest_runs')
        .insert({ source_id: connector.id, segment: segLabel, status: 'running' })
        .select().single();
      const runId = run.id;

      try {
        const raws = await connector.fetchListings(segment);
        const rows = [];
        let errors = 0;
        for (const raw of raws) {
          const n = connector.normalize(raw);
          if (!n) { errors++; continue; }
          rows.push(toRow(n));
        }
        if (rows.length) {
          const { error } = await deps.db.from('listings')
            .upsert(rows, { onConflict: 'source_id,external_id' });
          if (error) throw new Error(error.message);
        }
        const seenIds = rows.map((r) => r.external_id);
        // desactivar los no vistos de este source en esta corrida exitosa
        await deps.db.from('listings').update({ is_active: false })
          .eq('source_id', connector.id).eq('is_active', true)
          .not('external_id', 'in', `(${seenIds.map((s) => `"${s}"`).join(',') || '""'})`);

        const status = errors > 0 ? 'partial' : 'ok';
        await deps.db.from('ingest_runs').update({
          status, finished_at: new Date().toISOString(),
          fetched: raws.length, upserted: rows.length, errors,
        }).eq('id', runId);
        if (status === 'ok') summary.okRuns++; else summary.partialRuns++;
        summary.totalUpserted += rows.length;
      } catch (e: any) {
        await deps.db.from('ingest_runs').update({
          status: 'error', finished_at: new Date().toISOString(), error_detail: String(e?.message ?? e),
        }).eq('id', runId);
        summary.errorRuns++;
        // seguir con el siguiente connector/segmento
      }
    }
  }
  return summary;
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `npx vitest run tests/ingest/runner.test.ts`
Expected: PASS. (Si el doble de DB necesita ajustes de encadenamiento, alinear el doble del test con las llamadas reales — no cambiar la lógica del runner.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/ingest/runner.ts tests/ingest/runner.test.ts
git commit -m "feat: add resilient ingestion runner with tests"
```

---

### Task 10: Endpoint de ingesta + cron

**Files:**
- Create: `src/app/api/ingest/run/route.ts`, `vercel.json`

- [ ] **Step 1: Crear el route handler protegido**

Crear `src/app/api/ingest/run/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { CONNECTORS } from '@/lib/connectors';
import { generateSegments } from '@/lib/ingest/segments';
import { runIngestion } from '@/lib/ingest/runner';
import { BRANDS, PROVINCES, PRICE_RANGES } from '../../../../../supabase/seed/reference';

export const maxDuration = 300;

export async function POST(req: Request) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.INGEST_SECRET}`) {
    return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
  }
  const db = createServiceClient();
  const segments = generateSegments({ brands: BRANDS, provinces: PROVINCES, priceRanges: PRICE_RANGES });
  const summary = await runIngestion({ db, connectors: Object.values(CONNECTORS), segments });
  return NextResponse.json(summary);
}
```

- [ ] **Step 2: Configurar Vercel Cron**

Crear `vercel.json`:
```json
{
  "crons": [
    { "path": "/api/ingest/run", "schedule": "0 */6 * * *" }
  ]
}
```
Nota: Vercel Cron dispara con GET por defecto; para usar POST + secret, en producción configurar el cron para llamar con el header `Authorization`. Alternativa: aceptar también GET con el secret por query param protegido. Para el MVP, validar el secret en ambos métodos si hace falta.

- [ ] **Step 3: Probar el endpoint localmente (smoke)**

Run (con `npm run dev` en otra terminal y Supabase arriba):
```bash
curl -s -X POST http://localhost:3000/api/ingest/run -H "Authorization: Bearer dev-secret-change-me"
```
Expected: JSON con `okRuns/partialRuns/errorRuns/totalUpserted`. Verificar filas en `listings` vía Studio (`http://127.0.0.1:54323`). (Con credenciales de ML válidas traerá datos reales; sin ellas, los runs de ML saldrán `error` y los de deautos dependerán de la conectividad — el endpoint igual responde sin romperse.)

- [ ] **Step 4: Commit**

```bash
git add src/app/api/ingest/run/route.ts vercel.json
git commit -m "feat: add protected ingestion endpoint and cron schedule"
```

---

## Phase 4 — Búsqueda

### Task 11: Filtros (Zod) y query de búsqueda

**Files:**
- Create: `src/lib/search/filters.ts`, `src/lib/search/query.ts`, `tests/search/filters.test.ts`, `tests/search/query.test.ts`

- [ ] **Step 1: Test de parseo de filtros (falla)**

Crear `tests/search/filters.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseSearchParams } from '@/lib/search/filters';

describe('parseSearchParams', () => {
  it('parsea rangos numéricos y multiselect', () => {
    const f = parseSearchParams(new URLSearchParams(
      'brand=Volkswagen&brand=Ford&km_min=0&km_max=100000&price_min=5000&price_max=20000&currency=USD&page_price=10000&page_id=abc'
    ));
    expect(f.brand).toEqual(['Volkswagen', 'Ford']);
    expect(f.kmMin).toBe(0);
    expect(f.kmMax).toBe(100000);
    expect(f.currency).toBe('USD');
    expect(f.cursor).toEqual({ price: 10000, id: 'abc' });
  });

  it('ignora valores inválidos sin romper', () => {
    const f = parseSearchParams(new URLSearchParams('km_min=abc&year_min=1800'));
    expect(f.kmMin).toBeUndefined();
    expect(f.yearMin).toBe(1800); // se acepta; el filtro simplemente no matcheará
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run tests/search/filters.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar filtros**

Crear `src/lib/search/filters.ts`:
```ts
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
    sort: (['price','year','km','new'] as const).find((s) => s === p.get('sort')) ?? 'new',
    cursor: pp != null && pid ? { price: pp, id: pid } : undefined,
  };
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `npx vitest run tests/search/filters.test.ts`
Expected: PASS.

- [ ] **Step 5: Test de la query contra Supabase local (falla)**

Crear `tests/search/query.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { createServiceClient } from '@/lib/supabase/server';
import { searchListings } from '@/lib/search/query';

const db = createServiceClient();

beforeAll(async () => {
  await db.from('listings').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await db.from('listings').insert([
    { source_id: 'mercadolibre', external_id: 't1', url: 'u1', title: 'VW Golf', brand: 'Volkswagen', model: 'Golf', year: 2018, price: 14500, currency: 'USD', mileage_km: 80000, location_prov: 'CABA', seller_type: 'particular', is_active: true, dedup_key: 'k1' },
    { source_id: 'deautos', external_id: 't2', url: 'u2', title: 'VW Golf', brand: 'Volkswagen', model: 'Golf', year: 2018, price: 14600, currency: 'USD', mileage_km: 81000, location_prov: 'CABA', seller_type: 'particular', is_active: true, dedup_key: 'k1' },
    { source_id: 'mercadolibre', external_id: 't3', url: 'u3', title: 'Ford Focus', brand: 'Ford', model: 'Focus', year: 2015, price: 9000, currency: 'USD', mileage_km: 120000, location_prov: 'Córdoba', seller_type: 'concesionaria', is_active: true, dedup_key: 'k2' },
    { source_id: 'mercadolibre', external_id: 't4', url: 'u4', title: 'Viejo', brand: 'Fiat', model: 'Uno', year: 2005, price: 3000, currency: 'USD', mileage_km: 200000, location_prov: 'CABA', is_active: false, dedup_key: 'k3' },
  ]);
});

describe('searchListings', () => {
  it('filtra por marca y rango de km', async () => {
    const { items } = await searchListings(db, { brand: ['Volkswagen'], kmMin: 0, kmMax: 100000 });
    expect(items.every((i) => i.brand === 'Volkswagen')).toBe(true);
    expect(items.length).toBe(2);
  });

  it('excluye is_active=false', async () => {
    const { items } = await searchListings(db, { brand: ['Fiat'] });
    expect(items.length).toBe(0);
  });

  it('filtra por rango de precio', async () => {
    const { items } = await searchListings(db, { priceMin: 10000, priceMax: 20000 });
    expect(items.every((i) => i.price! >= 10000 && i.price! <= 20000)).toBe(true);
  });
});
```

- [ ] **Step 6: Correr y ver que falla**

Run: `npx vitest run tests/search/query.test.ts`
Expected: FAIL — `searchListings` no existe. (Requiere Supabase local arriba y `.env.local` cargado; ver Step 8 para config de Vitest.)

- [ ] **Step 7: Implementar la query**

Crear `src/lib/search/query.ts`:
```ts
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
```

- [ ] **Step 8: Configurar Vitest para cargar `.env.local`**

Crear `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import { config } from 'dotenv';

config({ path: '.env.local' });

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
```
Run: `npm install -D dotenv`

- [ ] **Step 9: Correr y ver que pasa**

Run: `npx vitest run tests/search/query.test.ts`
Expected: PASS (con Supabase local arriba).

- [ ] **Step 10: Commit**

```bash
git add src/lib/search/ tests/search/ vitest.config.ts package.json
git commit -m "feat: add search filters and keyset query with tests"
```

---

### Task 12: API route de búsqueda

**Files:**
- Create: `src/app/api/search/route.ts`

- [ ] **Step 1: Implementar el route handler**

Crear `src/app/api/search/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { parseSearchParams } from '@/lib/search/filters';
import { searchListings, groupByDedup } from '@/lib/search/query';

export async function GET(req: Request) {
  const filters = parseSearchParams(new URL(req.url).searchParams);
  const db = createServiceClient();
  const { items, nextCursor } = await searchListings(db, filters);
  return NextResponse.json({ groups: groupByDedup(items), nextCursor });
}
```

- [ ] **Step 2: Smoke test**

Run (con dev + Supabase arriba y datos sembrados del Task 11):
```bash
curl -s "http://localhost:3000/api/search?brand=Volkswagen&km_max=100000" | head -c 400
```
Expected: JSON con `groups` (array de arrays) y `nextCursor`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/search/route.ts
git commit -m "feat: add search API route"
```

---

## Phase 5 — UI

### Task 13: Layout base, landing y estilo

**Files:**
- Modify: `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx`

- [ ] **Step 1: Definir el layout y la paleta (limpio/sobrio)**

Modificar `src/app/layout.tsx` para incluir un header simple "Fierrin" y aplicar la tipografía/base. En `src/app/globals.css`, fijar la paleta azul corporativo (ej. primario `#1a3a5c`, fondo `#f7f9fc`, texto `#1f2933`) como variables CSS usadas por los componentes.
```tsx
// src/app/layout.tsx
import './globals.css';
export const metadata = { title: 'Fierrin', description: 'Encontrá tu próximo auto' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <header className="border-b bg-white">
          <div className="mx-auto max-w-6xl px-4 py-3 font-semibold text-[#1a3a5c]">Fierrin</div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Landing que lleva a /buscar**

Reemplazar `src/app/page.tsx`:
```tsx
import Link from 'next/link';
export default function Home() {
  return (
    <div className="text-center py-20">
      <h1 className="text-3xl font-bold text-[#1a3a5c]">Encontrá tu próximo auto</h1>
      <p className="mt-2 text-gray-600">Buscá en varios portales desde un solo lugar.</p>
      <Link href="/buscar" className="mt-6 inline-block rounded bg-[#1a3a5c] px-5 py-2 text-white">Buscar autos</Link>
    </div>
  );
}
```

- [ ] **Step 3: Verificar visualmente**

Run: `npm run dev` y abrir `http://localhost:3000`. Expected: landing con botón que navega a `/buscar`.

- [ ] **Step 4: Commit**

```bash
git add src/app/layout.tsx src/app/globals.css src/app/page.tsx
git commit -m "feat: add base layout, landing, and color palette"
```

---

### Task 14: Página de búsqueda (filtros + grilla + card)

**Files:**
- Create: `src/app/buscar/page.tsx`, `src/app/buscar/_components/filter-bar.tsx`, `src/app/buscar/_components/results-grid.tsx`, `src/app/buscar/_components/listing-card.tsx`

- [ ] **Step 1: Card de listing (con agrupación)**

Crear `src/app/buscar/_components/listing-card.tsx`:
```tsx
import Link from 'next/link';
import type { ListingRow } from '@/lib/search/query';

export function ListingCard({ group }: { group: ListingRow[] }) {
  const main = group[0];
  const others = group.length - 1;
  const price = main.price != null ? `${main.currency === 'USD' ? 'US$' : '$'} ${main.price.toLocaleString('es-AR')}` : 's/precio';
  return (
    <Link href={`/aviso/${main.id}`} className="block rounded-lg border bg-white overflow-hidden hover:shadow-md transition">
      <div className="aspect-video bg-[#e8eef5] flex items-center justify-center text-[#7a8aa0]">
        {main.thumbnail_url ? <img src={main.thumbnail_url} alt={main.title} className="h-full w-full object-cover" /> : 'sin foto'}
      </div>
      <div className="p-3">
        <h3 className="font-medium truncate">{main.title}</h3>
        <div className="text-lg font-bold text-[#1a3a5c]">{price}</div>
        <p className="text-sm text-gray-600">
          {[main.year, main.mileage_km != null ? `${main.mileage_km.toLocaleString('es-AR')} km` : null, main.location_prov].filter(Boolean).join(' · ')}
        </p>
        <div className="mt-1 flex gap-1 text-xs">
          <span className="rounded-full bg-[#eef2f7] px-2 py-0.5">{main.source_id}</span>
          {others > 0 && <span className="rounded-full bg-[#e6f7ec] px-2 py-0.5 text-[#1e8a4c]">También en {others} portal{others > 1 ? 'es' : ''}</span>}
        </div>
      </div>
    </Link>
  );
}
```

- [ ] **Step 2: Grilla de resultados**

Crear `src/app/buscar/_components/results-grid.tsx`:
```tsx
import type { ListingRow } from '@/lib/search/query';
import { ListingCard } from './listing-card';

export function ResultsGrid({ groups }: { groups: ListingRow[][] }) {
  if (!groups.length) {
    return <p className="py-16 text-center text-gray-500">Sin resultados para estos filtros.</p>;
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {groups.map((g) => <ListingCard key={g[0].id} group={g} />)}
    </div>
  );
}
```

- [ ] **Step 3: Barra de filtros (client component)**

Crear `src/app/buscar/_components/filter-bar.tsx`:
```tsx
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
  const set = (k: string) => (e: any) => setState((s) => ({ ...s, [k]: e.target.value }));
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
```

- [ ] **Step 4: Página de búsqueda (server component)**

Crear `src/app/buscar/page.tsx`:
```tsx
import { createServiceClient } from '@/lib/supabase/server';
import { parseSearchParams } from '@/lib/search/filters';
import { searchListings, groupByDedup } from '@/lib/search/query';
import { FilterBar } from './_components/filter-bar';
import { ResultsGrid } from './_components/results-grid';

export const dynamic = 'force-dynamic';

export default async function BuscarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  const resolved = await searchParams;
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(resolved)) {
    (Array.isArray(v) ? v : [v]).forEach((val) => usp.append(k, val));
  }
  const filters = parseSearchParams(usp);

  let groups: Awaited<ReturnType<typeof groupByDedup>> = [];
  let failed = false;
  try {
    const db = createServiceClient();
    const { items } = await searchListings(db, filters);
    groups = groupByDedup(items);
  } catch {
    failed = true;
  }

  return (
    <div>
      <FilterBar />
      {failed
        ? <p className="py-16 text-center text-red-600">No pudimos cargar los resultados. Probá de nuevo.</p>
        : <ResultsGrid groups={groups} />}
    </div>
  );
}
```

- [ ] **Step 5: Verificar visualmente**

Run: `npm run dev`, abrir `http://localhost:3000/buscar` (con datos sembrados del Task 11). Expected: barra de filtros arriba + grilla de cards; aplicar marca "Volkswagen" filtra y la URL refleja `?brand=Volkswagen`; las dos publicaciones VW con misma `dedup_key` aparecen agrupadas ("También en 1 portal").

- [ ] **Step 6: Commit**

```bash
git add src/app/buscar/
git commit -m "feat: add search page with filter bar, grid, and dedup-grouped cards"
```

---

### Task 15: Página de detalle del aviso

**Files:**
- Create: `src/app/aviso/[id]/page.tsx`

- [ ] **Step 1: Implementar el detalle**

Crear `src/app/aviso/[id]/page.tsx`:
```tsx
import { createServiceClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function AvisoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = createServiceClient();
  const { data } = await db.from('listings').select('*').eq('id', id).single();
  if (!data) notFound();
  const price = data.price != null ? `${data.currency === 'USD' ? 'US$' : '$'} ${Number(data.price).toLocaleString('es-AR')}` : 's/precio';
  return (
    <article className="max-w-2xl">
      <h1 className="text-2xl font-bold">{data.title}</h1>
      <div className="mt-1 text-xl font-bold text-[#1a3a5c]">{price}</div>
      <ul className="mt-4 grid grid-cols-2 gap-2 text-sm text-gray-700">
        <li>Año: {data.year ?? 's/d'}</li>
        <li>Km: {data.mileage_km != null ? Number(data.mileage_km).toLocaleString('es-AR') : 's/d'}</li>
        <li>Provincia: {data.location_prov ?? 's/d'}</li>
        <li>Combustible: {data.fuel ?? 's/d'}</li>
        <li>Transmisión: {data.transmission ?? 's/d'}</li>
        <li>Vendedor: {data.seller_type ?? 's/d'}</li>
        <li>Portal: {data.source_id}</li>
      </ul>
      <a href={data.url} target="_blank" rel="noopener noreferrer"
         className="mt-6 inline-block rounded bg-[#1a3a5c] px-5 py-2 text-white">
        Ver publicación original
      </a>
    </article>
  );
}
```

- [ ] **Step 2: Verificar**

Run: `npm run dev`, clic en una card desde `/buscar`. Expected: detalle con specs y botón "Ver publicación original" que abre el portal en otra pestaña.

- [ ] **Step 3: Commit**

```bash
git add src/app/aviso/
git commit -m "feat: add listing detail page linking to original portal"
```

---

## Phase 6 — E2E

### Task 16: Test E2E del happy-path (Playwright)

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/buscar.spec.ts`

- [ ] **Step 1: Configurar Playwright**

Crear `playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  use: { baseURL: 'http://localhost:3000' },
  webServer: { command: 'npm run dev', url: 'http://localhost:3000', reuseExistingServer: true },
});
```

- [ ] **Step 2: Escribir el test E2E**

Pre-requisito: Supabase local arriba con los datos sembrados del Task 11 (o un seed dedicado). Crear `tests/e2e/buscar.spec.ts`:
```ts
import { test, expect } from '@playwright/test';

test('buscar, filtrar y abrir detalle', async ({ page }) => {
  await page.goto('/buscar');
  await expect(page.getByText('Fierrin')).toBeVisible();

  // aplicar filtro de marca
  await page.locator('select').first().selectOption('Volkswagen');
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page).toHaveURL(/brand=Volkswagen/);

  // abrir el primer resultado
  const firstCard = page.locator('a[href^="/aviso/"]').first();
  await expect(firstCard).toBeVisible();
  await firstCard.click();

  // el detalle muestra el link al portal original
  await expect(page.getByRole('link', { name: 'Ver publicación original' })).toBeVisible();
});
```

- [ ] **Step 3: Correr el E2E**

Run: `npx playwright test`
Expected: PASS (con Supabase arriba y datos sembrados).

- [ ] **Step 4: Commit**

```bash
git add playwright.config.ts tests/e2e/
git commit -m "test: add E2E happy-path for search and detail"
```

---

## Self-Review (cobertura del spec)

- **Ingesta API+scrape** → Tasks 7, 8. **Modelo programado a DB** → Tasks 9, 10.
- **Esquema (sources/listings/ingest_runs + índices)** → Task 2. **Dedup buckets** → Task 5.
- **Segmentación para catálogo amplio** → Task 6. **Resiliencia (portal cae → sigue)** → Task 9.
- **Búsqueda con todos los filtros incl. rango km/precio + keyset** → Tasks 11, 12.
- **UI barra superior + cards + agrupación "También en N portales" + estilo limpio/sobrio** → Tasks 13, 14.
- **Detalle → link al portal original (sin intermediar)** → Task 15.
- **Testing por capa (unit normalizer/dedup/segments, integración runner/search, E2E)** → Tasks 4, 5, 6, 9, 11, 16.
- **Estados vacíos / error en UI** → Tasks 14 (vacío + error).
- **Riesgo ToS/scraping** → notas de verificación en Tasks 7, 8.

Criterios de éxito del spec (1–5) cubiertos por Tasks 9/10 (ingesta ≥2 portales), 11/12/14 (búsqueda filtrable incl. km), 14 (agrupación duplicados), 9 (resiliencia), 15 (link al original).
```
