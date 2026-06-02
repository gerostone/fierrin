# Fierrin

Agregador de autos usados de Argentina. Reúne publicaciones de varios portales de venta de autos en una sola búsqueda unificada, con deduplicación cross-portal: un mismo auto publicado en distintos sitios se muestra una sola vez, indicando en cuántos portales aparece.

> **Estado:** MVP (sub-proyecto 1) funcionando — ingesta + normalización + dedup + búsqueda. Fuente activa: **deautos**. La fuente **MercadoLibre** está implementada (connector + OAuth Authorization Code) y el OAuth funciona end-to-end, pero **ML bloquea por política** (`403 PolicyAgent`) el acceso de apps estándar a la API de búsqueda/items: el connector queda desactivado (`ML_ENABLED`) a la espera de que ML apruebe el acceso a esos recursos (ver [Roadmap](#roadmap)).

---

## Índice

- [Qué hace](#qué-hace)
- [Stack](#stack)
- [Arquitectura en una imagen](#arquitectura-en-una-imagen)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Puesta en marcha](#puesta-en-marcha)
- [Variables de entorno](#variables-de-entorno)
- [Scripts](#scripts)
- [Base de datos](#base-de-datos)
- [Ingesta de datos](#ingesta-de-datos)
- [API HTTP](#api-http)
- [Búsqueda y filtros](#búsqueda-y-filtros)
- [Testing](#testing)
- [Deploy](#deploy)
- [Roadmap](#roadmap)
- [Documentación adicional](#documentación-adicional)

---

## Qué hace

1. **Ingesta programada** (cron) recorre el catálogo de cada portal por segmentos (marca × provincia × rango de precio) y guarda las publicaciones en Supabase.
2. **Normalización**: cada portal trae datos en su propio formato; un *connector* los traduce a una forma única (`NormalizedListing`) que el resto del sistema entiende.
3. **Deduplicación cross-portal**: una `dedup_key` por cubetas (marca, modelo, año, bucket de km, bucket de precio, provincia) agrupa el mismo auto publicado en distintos portales.
4. **Búsqueda unificada**: una sola UI con filtros (marca, provincia, **rango de precio**, **rango de km — piso y techo**, año) sobre todas las fuentes, con paginación keyset.

---

## Stack

| Capa | Tecnología |
|------|-----------|
| Framework | Next.js 16.2.7 (App Router, Turbopack, dir `src/`) |
| UI | React 19, Tailwind v4, shadcn/ui |
| Base de datos | Supabase (Postgres 17) |
| Lenguaje | TypeScript 5 |
| Tests unit/integración | Vitest 3 |
| Tests E2E | Playwright 1.60 |
| Scraping | Parsing de JSON / `cheerio` (según portal) |
| Validación | Zod |

> ⚠️ **Esta versión de Next.js tiene breaking changes** respecto de versiones anteriores. En server components, `params` y `searchParams` vienen envueltos en `Promise` y hay que hacerles `await`. Ver `AGENTS.md` y los docs en `node_modules/next/dist/docs/` antes de tocar código.

---

## Arquitectura en una imagen

```
                         ┌─────────────────────────────┐
   Cron (cada 6h)  ───▶  │  POST/GET /api/ingest/run    │  (protegido con INGEST_SECRET)
                         └──────────────┬──────────────┘
                                        │
                                        ▼
                         ┌─────────────────────────────┐
                         │  runIngestion()              │
                         │  por connector × segmento:   │
                         │   fetchListings → normalize  │
                         │   → upsert → deactivate stale│
                         └──────────────┬──────────────┘
                                        │  NormalizedListing
                                        ▼
   Connector (deautos, ...)   ─────────────────────────▶   Supabase (tabla listings)
   (cada portal implementa la                                    │
    interfaz Connector)                                          │ dedup_key
                                                                 ▼
                         ┌─────────────────────────────┐
   Usuario  ───▶  /buscar │  searchListings + groupByDedup │  ◀── GET /api/search
                         └─────────────────────────────┘
                                        │
                                        ▼
                              /aviso/[id]  → link al portal original
```

**Principio clave:** el resto del sistema **solo conoce `NormalizedListing`**. Agregar un portal nuevo es escribir un `Connector`; nada más cambia.

---

## Estructura del proyecto

```
src/
├── app/
│   ├── page.tsx                      # Landing
│   ├── layout.tsx                    # Layout base + header + paleta
│   ├── buscar/
│   │   ├── page.tsx                  # Página de búsqueda (server component)
│   │   └── _components/
│   │       ├── filter-bar.tsx        # Barra de filtros (client)
│   │       ├── results-grid.tsx      # Grilla de resultados
│   │       └── listing-card.tsx      # Card con badge de dedup
│   ├── aviso/[id]/page.tsx           # Detalle del aviso + link al portal
│   └── api/
│       ├── ingest/run/route.ts       # Endpoint de ingesta (cron)
│       └── search/route.ts           # Endpoint de búsqueda (JSON)
├── lib/
│   ├── types.ts                      # Connector, NormalizedListing, Segment, ...
│   ├── normalize.ts                  # parseKm, parsePrice, normalizeBrand, normalizeProv
│   ├── dedup.ts                      # computeDedupKey
│   ├── connectors/
│   │   ├── index.ts                  # Registro de connectors activos
│   │   └── deautos.ts                # Connector de deautos (JSON)
│   ├── ingest/
│   │   ├── segments.ts               # generateSegments (marca × prov × precio)
│   │   └── runner.ts                 # runIngestion (orquesta la corrida)
│   ├── search/
│   │   ├── filters.ts                # parseSearchParams → SearchFilters
│   │   └── query.ts                  # searchListings + groupByDedup (keyset)
│   └── supabase/server.ts            # createServiceClient (service role)
├── components/ui/                    # Primitivas shadcn (badge, button, card, ...)
supabase/
├── config.toml                       # Config local (puertos +1000, servicios mínimos)
├── migrations/
│   ├── 0001_init_schema.sql          # Tablas + índices
│   └── 0002_seed_sources.sql         # Semilla de sources
└── seed/reference.ts                 # BRANDS, PROVINCES, PRICE_RANGES
tests/                                # Unit/integración (Vitest) + E2E (Playwright)
docs/
├── ARQUITECTURA.md                   # Deep dive técnico
└── superpowers/                      # Spec y plan del MVP
```

---

## Puesta en marcha

### Requisitos

- Node.js 20+
- Docker (para Supabase local)
- [Supabase CLI](https://supabase.com/docs/guides/local-development)

### Pasos

```bash
# 1. Instalar dependencias
npm install

# 2. Levantar Supabase local (puertos +1000 para no chocar con otros stacks)
npx supabase start

# 3. Aplicar migraciones y semillas
npx supabase db reset

# 4. Crear .env.local (ver sección siguiente) con los valores que imprime:
npx supabase status

# 5. Levantar la app
npm run dev
# → http://localhost:3000

# 6. (Opcional) Poblar con datos reales lanzando una ingesta
curl -X POST http://localhost:3000/api/ingest/run \
  -H "Authorization: Bearer $INGEST_SECRET"
```

> **Nota sobre el entorno local:** este `config.toml` usa **puertos desplazados +1000** (API `55321`, DB `55322`, Studio `55323`, Inbucket `55324`) y deja **deshabilitados** los servicios que el MVP no necesita: `storage`, `edge_runtime` y `analytics`. Esto permite convivir con otro stack de Supabase corriendo en paralelo.

---

## Variables de entorno

Crear `.env.local` en la raíz (está en `.gitignore` — **nunca commitear**):

```bash
# Supabase local — generado por `supabase status` (puertos propios +1000)
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>

# Protege el endpoint de ingesta y el inicio del OAuth de ML (cualquier string secreto)
INGEST_SECRET=<secreto largo y aleatorio>

# MercadoLibre OAuth — App ID / Secret Key de https://developers.mercadolibre.com.ar
ML_CLIENT_ID=<app id>
ML_CLIENT_SECRET=<secret key>
# La Redirect URI debe ser un dominio público https (ML rechaza http y localhost).
# Para autorizar en local usá un túnel (p.ej. cloudflared) y registrá esa URL en la app.
ML_REDIRECT_URI=https://<tu-tunel>.trycloudflare.com/api/ml/callback
# Activá el connector de ML sólo cuando ML apruebe el acceso a search/items (hoy bloqueado por PolicyAgent).
ML_ENABLED=false
```

> ⚠️ ML **exige `https://`** en la redirect URI (rechaza `http://localhost`). Para autorizar en local corré `npm run dev:https` (Next genera un cert autofirmado; aceptá la advertencia del navegador). El `dev` normal en http sigue para el resto del desarrollo y los E2E.

| Variable | Para qué | Dónde se usa |
|----------|----------|--------------|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase | cliente + server |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave pública | cliente |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave service-role (solo server) | `lib/supabase/server.ts` |
| `INGEST_SECRET` | Bearer token de ingesta + `?secret=` del login de ML | `api/ingest/run`, `api/ml/login` |
| `ML_CLIENT_ID` / `ML_CLIENT_SECRET` | Credenciales OAuth de MercadoLibre | `lib/ml/oauth.ts` |
| `ML_REDIRECT_URI` | Redirect registrada en la app de ML | `lib/ml/oauth.ts`, callback |

---

## Scripts

| Comando | Qué hace |
|---------|----------|
| `npm run dev` | Servidor de desarrollo (Turbopack) |
| `npm run dev:https` | Dev con HTTPS (cert autofirmado) — necesario para el OAuth de ML |
| `npm run build` | Build de producción |
| `npm start` | Servir el build |
| `npm run lint` | ESLint |
| `npm test` | Tests unit/integración (Vitest, una corrida) |
| `npm run test:e2e` | Tests E2E (Playwright) |

---

## Base de datos

Tablas en `supabase/migrations/` — `0001` define `sources`, `listings` e `ingest_runs`; `0003` agrega `oauth_tokens` (una fila por proveedor: access/refresh token + vencimiento, usada por el OAuth de MercadoLibre).

### `sources`
Catálogo de portales. `type` es `'api'` o `'scrape'`.

| Columna | Tipo | Notas |
|---------|------|-------|
| `id` | text PK | ej. `deautos` |
| `name` | text | nombre legible |
| `type` | text | `api` \| `scrape` |
| `enabled` | bool | |

### `listings`
Las publicaciones normalizadas.

| Columna | Tipo | Notas |
|---------|------|-------|
| `id` | uuid PK | |
| `source_id` | text FK → sources | |
| `external_id` | text | id estable dentro del portal |
| `url`, `title`, `thumbnail_url` | text | |
| `brand`, `model`, `year` | text/int | |
| `price`, `currency` | numeric / `ARS`\|`USD` | |
| `mileage_km`, `location_prov` | int / text | |
| `fuel`, `transmission`, `seller_type` | text | `seller_type`: `particular`\|`concesionaria` |
| `raw` | jsonb | payload original del portal |
| `first_seen_at`, `last_seen_at` | timestamptz | |
| `is_active` | bool | se apaga cuando el aviso deja de verse |
| `dedup_key` | text | clave de agrupación cross-portal |

Restricción única: `(source_id, external_id)` → permite `upsert` idempotente.
Índices: por `brand`, `model`, `year`, `price`, `mileage_km`, `location_prov`, `dedup_key`, `is_active`, y un índice keyset `(price, id)` para paginación.

### `ingest_runs`
Auditoría: una fila por (connector × segmento) por corrida, con `status` (`running`/`ok`/`partial`/`error`), contadores (`fetched`, `upserted`, `errors`) y `error_detail`.

---

## Ingesta de datos

### Cómo funciona (`lib/ingest/runner.ts`)

Por cada **connector** activo, por cada **segmento**:

1. Registra una fila `ingest_runs` en estado `running`.
2. `connector.fetchListings(segment)` → lista de raws.
3. `connector.normalize(raw)` por cada uno; los inválidos se descartan y se cuentan como errores.
4. `upsert` en `listings` con `onConflict: (source_id, external_id)` → refresca `last_seen_at`.
5. Marca la corrida `ok` / `partial` / `error`.

Al terminar **todos** los segmentos de un connector (y solo si hubo datos frescos), **desactiva** (`is_active = false`) las publicaciones de ese source cuyo `last_seen_at` quedó anterior al inicio de la corrida — es decir, las que ya no aparecen.

> **Resiliencia:** si un portal se cae, su error se aísla por segmento y **no frena** a los demás. Un source cuyos segmentos fallaron todos **no** se desactiva (no se borra el catálogo existente por una caída transitoria).

### Segmentación (`lib/ingest/segments.ts`)

`generateSegments` produce el producto cartesiano **marca × provincia × rango de precio**. Con la referencia actual (7 marcas × 5 provincias × 4 rangos) son **140 segmentos**. Sirve para recorrer catálogos grandes sin topar el límite de paginación de cada portal.

### Programación

`vercel.json` define el cron: `0 */6 * * *` (cada 6 horas) golpeando `/api/ingest/run`.

---

## API HTTP

### `GET|POST /api/ingest/run`
Lanza una corrida de ingesta. **Requiere** header `Authorization: Bearer <INGEST_SECRET>`.
Falla cerrado: si `INGEST_SECRET` no está configurado, el endpoint rechaza todo. Comparación en tiempo constante.

- **200** → `{ okRuns, partialRuns, errorRuns, totalUpserted }`
- **401** → sin/with token inválido

```bash
curl -X POST http://localhost:3000/api/ingest/run \
  -H "Authorization: Bearer $INGEST_SECRET"
```

### `GET /api/ml/login` y `GET /api/ml/callback` (OAuth de MercadoLibre)
ML deprecó el grant `client_credentials`, así que la app se autoriza una vez con el flujo Authorization Code:

1. Abrí `https://<tu-tunel>/api/ml/login?secret=<INGEST_SECRET>` (mismo dominio que la Redirect URI, para que la cookie de `state` viaje al callback). Setea una cookie `state` anti-CSRF y redirige a la pantalla de autorización de ML.
2. Autorizás con tu cuenta de ML; ML redirige a `/api/ml/callback?code=…&state=…`.
3. El callback valida el `state`, canjea el `code` por access + refresh token y los persiste en la tabla `oauth_tokens`.

A partir de ahí, el connector de ML obtiene un access token válido vía `getValidToken()` (refresca solo cuando está por vencer). El `login` está protegido con `INGEST_SECRET` para que nadie sobrescriba los tokens con otra cuenta.

**Requisitos en la config de la app de ML** (portal de desarrolladores → tu app → *Configuración y scopes*):
- **Flujos OAuth:** tildar **Refresh Token** (además de Authorization Code). Sin esto ML no devuelve `refresh_token` y el access token vence en ~6h sin renovación.
- **Redirect URI:** un dominio público https (ML rechaza `http` y `localhost`).

> **⚠️ Bloqueo de ML (PolicyAgent):** con OAuth válido, ML responde `403 PA_UNAUTHORIZED_RESULT_FROM_POLICIES` (`blocked_by: PolicyAgent`) a `/sites/MLA/search` y `/items/{id}` para apps estándar. Sólo funcionan endpoints de metadata (p.ej. `/categories/MLA1744`) y `/users/me`. El acceso a búsqueda/items requiere aprobación de ML; hasta entonces el connector está fuera del registro (`ML_ENABLED=false`).

### `GET /api/search`
Búsqueda en JSON. Acepta todos los filtros como query params (ver abajo).

- **200** → `{ groups: ListingRow[][], nextCursor: { price, id } | null }`

```bash
curl "http://localhost:3000/api/search?brand=Volkswagen&km_min=20000&km_max=80000"
```

---

## Búsqueda y filtros

Filtros soportados (`lib/search/filters.ts`), vía query params:

| Param | Tipo | Descripción |
|-------|------|-------------|
| `q` | string | texto en el título (ilike) |
| `brand` | repetible | una o más marcas |
| `model` | repetible | uno o más modelos |
| `year_min` / `year_max` | int | rango de año |
| `price_min` / `price_max` | int | **rango de precio** |
| `km_min` / `km_max` | int | **rango de km (piso y techo)** |
| `currency` | `ARS`\|`USD` | |
| `prov` | repetible | una o más provincias |
| `fuel`, `transmission` | string | |
| `seller_type` | `particular`\|`concesionaria` | |
| `sources` | repetible | filtrar por portal |
| `sort` | `price`\|`year`\|`km`\|`new` | orden (default `new`) |
| `page_price` + `page_id` | cursor | paginación keyset (solo orden `price`) |

**Paginación keyset:** estable sobre `(price, id)`. Solo el orden por precio emite `nextCursor`; los otros órdenes devuelven la primera página (paginación pendiente para ellos).

**Deduplicación:** `groupByDedup` agrupa los resultados por `dedup_key`; los avisos sin clave quedan individuales. La card muestra "También en N portales" cuando un grupo tiene más de uno.

---

## Testing

```bash
npm test          # Vitest: normalize, dedup, segments, runner, filters, query, connector
npm run test:e2e  # Playwright: happy-path buscar → filtrar → detalle
```

> ⚠️ **`tests/search/query.test.ts` es un test de integración contra la DB local**: su `beforeAll` **borra todas las `listings`** e inserta filas deterministas. Tras correr la suite, repoblá con una ingesta (`curl … /api/ingest/run`) si necesitás datos reales en el entorno.

E2E requiere la app y Supabase arriba con datos sembrados; `playwright.config.ts` reusa el dev server si ya está corriendo.

---

## Deploy

Pensado para **Vercel**:

- El cron de `vercel.json` dispara la ingesta cada 6h.
- Configurar en Vercel las mismas variables de entorno (apuntando a un Supabase gestionado, no al local).
- `maxDuration = 300` en el endpoint de ingesta para corridas largas.

---

## Roadmap

- [ ] **Acceso a la API de listings de MercadoLibre** (Tarea 7) — connector + OAuth ya implementados, testeados y con autorización end-to-end funcionando (token + refresh persistidos en `oauth_tokens`). **Bloqueado por ML:** `/sites/MLA/search` e `/items` devuelven `403 PolicyAgent` para apps estándar. Pendiente: **solicitar a ML el acceso a esos recursos**; al obtenerlo, poner `ML_ENABLED=true`, **reemplazar el fixture sintético `tests/fixtures/ml-search-sample.json` por una captura real** y confirmar nombres de campo/atributo y el ID de categoría contra la respuesta real.
- [ ] Paginación keyset para los órdenes `year` / `km` / `new`.
- [ ] Lock para evitar solapamiento entre una corrida de cron y una ingesta manual concurrente.
- [ ] Más portales (cada uno = un nuevo `Connector`).

---

## Documentación adicional

- [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md) — deep dive: pipeline de ingesta, dedup por cubetas, keyset, y **cómo agregar un connector nuevo**.
- [`docs/superpowers/specs/`](docs/superpowers/specs/) — spec de diseño del MVP.
- [`docs/superpowers/plans/`](docs/superpowers/plans/) — plan de implementación tarea por tarea.
- `AGENTS.md` — nota importante sobre los breaking changes de esta versión de Next.js.
