# Fierrin — Sub-proyecto 1: Ingesta + Búsqueda unificada (MVP)

**Fecha:** 2026-06-01
**Estado:** Diseño aprobado
**Stack:** Next.js (App Router) + Supabase (Postgres, scheduled functions) + Tailwind + shadcn/ui

## Contexto y alcance

Fierrin es una app web para ayudar a encontrar un auto agregando publicaciones de
varios portales argentinos de compra-venta (MercadoLibre, deautos, etc.).

El producto completo se compone de cinco subsistemas, que se construyen en
sub-proyectos independientes (cada uno con su propio spec → plan → implementación):

1. **Ingesta + búsqueda unificada** ← *este documento (MVP)*
2. Cuentas + favoritos + comparación
3. Alertas sobre búsquedas guardadas
4. Análisis de precio (requiere histórico acumulado)

Este spec cubre **solo el sub-proyecto 1**: traer datos de los portales,
normalizarlos a un esquema común, guardarlos en Supabase, y exponer una búsqueda
unificada con filtros en una UI mínima.

### Fuera de alcance (sub-proyectos posteriores)

- Cuentas de usuario / auth, favoritos, comparación lado a lado.
- Alertas y notificaciones.
- Análisis de precio / historial / valor estimado de mercado.
- Intermediación de la transacción (Fierrin siempre linkea al portal original).

### Decisiones tomadas

- **Producto para terceros** (no solo uso personal): se prioriza robustez y mantenibilidad.
- **Mercado:** Argentina.
- **Estrategia de datos:** API oficial donde exista (MercadoLibre), scraping donde no.
- **Modelo de ingesta:** programada (cron) a la DB. La búsqueda consulta Postgres.
- **Amplitud:** catálogo amplio de autos AR, segmentando para cubrir todo.
- **UI:** layout de barra superior + cards grandes; estilo visual "limpio / sobrio"
  (azul corporativo, foco en los datos).

### Riesgo conocido

El scraping de portales sin API puede violar sus términos de uso y exponer
legalmente al ser un producto para terceros. Mitigaciones de diseño: priorizar
APIs oficiales, scraping cortés (user-agent honesto, backoff, respetar
`robots.txt`). La postura legal debe revisarse antes de habilitar cada connector
de scraping en producción.

## Arquitectura

```
Portales (ML API, deautos scrape, ...)
        │  fetch (cron)
        ▼
Ingestion workers  ──normaliza + dedup + upsert──▶  Supabase Postgres
(Supabase scheduled                                  (sources, listings,
 functions / pg_cron)                                 ingest_runs)
                                                          │
                                                          ▼
                                                  Next.js app (búsqueda + UI)
```

Principio rector: **el resto del sistema nunca sabe de qué portal vino un dato.**
Todo consume `NormalizedListing`. Sumar un portal = agregar un connector, sin
tocar búsqueda, esquema ni UI.

### Componentes (cada uno con un propósito único)

| Componente | Ubicación | Responsabilidad | Depende de |
|---|---|---|---|
| **Connector** | `lib/connectors/<portal>.ts` | Implementa interfaz común `Connector`; `fetchListings(segment)` devuelve listings crudos del portal | HTTP / API del portal |
| **Normalizer** | `lib/normalize.ts` | Convierte listing crudo de cualquier portal a `NormalizedListing` | — (lógica pura) |
| **Dedup** | `lib/dedup.ts` | Calcula `dedup_key` para agrupar posibles duplicados cross-portal | — (lógica pura) |
| **Ingestion runner** | `lib/ingest/runner.ts` | Orquesta: recorre segmentos, llama connectors, normaliza, deduplica, upsert; registra `ingest_runs` | Connectors, Normalizer, Dedup, DB |
| **Segmentación** | `lib/ingest/segments.ts` | Genera segmentos (marca × provincia × rango precio) para cubrir el catálogo sin topar el límite de paginación | Tablas de referencia |
| **Scheduler** | Supabase scheduled function / pg_cron | Dispara el runner periódicamente | Runner |
| **Search API** | `app/api/search/route.ts` | Traduce filtros a query Postgres; paginación keyset | DB |
| **UI** | `app/`, componentes | Filtros + grilla de resultados + detalle | Search API |

### Interfaz `Connector`

```ts
interface Connector {
  id: string;                 // 'mercadolibre' | 'deautos'
  type: 'api' | 'scrape';
  fetchListings(segment: Segment): Promise<RawListing[]>;
}
```

## Modelo de datos (Supabase Postgres)

### `sources`
```
id            text PK        -- 'mercadolibre', 'deautos'
name          text
type          text           -- 'api' | 'scrape'
enabled       bool
```

### `listings`
```
id              uuid PK default gen_random_uuid()
source_id       text  FK → sources
external_id     text           -- id de la publicación en el portal
url             text
title           text
brand           text           -- normalizado ('Volkswagen')
model           text
year            int
price           numeric
currency        text           -- 'ARS' | 'USD'
mileage_km      int
location_prov   text           -- provincia normalizada
fuel            text
transmission    text
seller_type     text           -- 'particular' | 'concesionaria'
thumbnail_url   text
raw             jsonb          -- payload crudo (para re-normalizar)
first_seen_at   timestamptz default now()
last_seen_at    timestamptz default now()
is_active       bool   default true
dedup_key       text
UNIQUE (source_id, external_id)
```
Índices: `brand`, `model`, `year`, `price`, `mileage_km`, `location_prov`,
`dedup_key`, `is_active`. Índice keyset para paginación (ej. `(price, id)`).

### `ingest_runs`
```
id            uuid PK default gen_random_uuid()
source_id     text
segment       text          -- ej. 'brand=vw&prov=caba&price=0-15000'
started_at    timestamptz
finished_at   timestamptz
status        text          -- 'running' | 'ok' | 'partial' | 'error'
fetched       int
upserted      int
errors        int
error_detail  text
```

### Deduplicación

- **Dentro de un portal:** `UNIQUE(source_id, external_id)` evita duplicados exactos.
- **Cross-portal:** `dedup_key = hash(brand | model | year | mileage_bucket | price_bucket | location_prov)`.
  Listings con la misma key se **agrupan** en la UI ("También en N portales"),
  no se borran. Evita falsos merges y no se pierde información. (No hay VIN
  disponible en los portales, por eso el enfoque por buckets en vez de match exacto.)

## Pipeline de ingesta

### Segmentación

La API de MercadoLibre limita la paginación (~1000 resultados por query). Para
cubrir "todos los autos AR" sin topar ese límite, el espacio se divide en
**segmentos** = `marca × provincia × rango de precio`. Cada segmento debe
devolver < límite y se pagina completo. Los segmentos se generan desde tablas de
referencia (marcas, provincias) y, si un segmento sigue topando el límite, se
subdivide por rango de precio.

### Flujo de una corrida

```
para cada source enabled:
  para cada segment:
    crear ingest_run (status=running)
    raws = connector.fetchListings(segment)        # timeout + retry/backoff + throttle
    para cada raw:
      norm = normalize(source, raw)                # descarta y cuenta si es inválido
      norm.dedup_key = computeDedupKey(norm)
      upsert listings (por source_id+external_id):
        existe → update precio/last_seen_at/is_active=true
        nuevo  → insert con first_seen_at
    si run ok: marcar is_active=false los listings del segment no vistos
    cerrar ingest_run (ok | partial | error + métricas)
```

- **Idempotente:** repetir una corrida no duplica (upsert por clave única).
- **Frecuencia:** cron cada 6 h (configurable).
- **Connectors del MVP:** MercadoLibre (API) end-to-end + un portal de scraping
  (ej. deautos) para validar que la interfaz `Connector` abstrae ambos casos.

## Búsqueda y UI

### Search API — `GET /api/search`

Filtros: `q` (texto libre sobre título/marca/modelo), `brand[]`, `model[]`,
`year_min`/`year_max`, `price_min`/`price_max` + `currency`,
`km_min`/`km_max`, `location_prov[]`, `fuel`, `transmission`, `seller_type`,
`sources[]`. Orden: precio, año, km, `first_seen_at`. Solo `is_active = true`.
Paginación **keyset** (estable y rápida).

### Páginas

```
/              → landing simple → /buscar
/buscar        → barra de filtros superior + grilla de cards
/aviso/[id]    → detalle (specs + link al portal original)
```

### UI

- **Layout:** barra de filtros rápidos arriba (Marca, Precio, Km mín–máx, Año,
  Provincia, + Filtros) + grilla de cards grandes con foto protagonista.
- **Estilo visual:** limpio / sobrio, azul corporativo, foco en los datos.
- **Card:** foto, título, precio destacado, año, km, ubicación, tipo de vendedor,
  badge del portal. Si comparte `dedup_key` con otros: badge "También en N
  portales" que expande las variantes.
- **Filtros reflejados en la URL** (querystring) → búsquedas compartibles y
  bookmarkeables. Deja lista la base para el futuro sub-proyecto de alertas
  (búsqueda guardada = querystring).
- El click en un aviso linkea al **portal original**; Fierrin no intermedia la compra.
- Estados vacíos explícitos ("Sin resultados para estos filtros").

## Manejo de errores y resiliencia

Principio: **un portal que falla nunca tumba la ingesta ni la búsqueda.**

- **Por segmento/portal:** timeout + retry con backoff exponencial (429/5xx) +
  límite de reintentos. Si falla, se marca `error` en `ingest_runs` y el runner
  sigue con el resto. Los datos previos quedan en la DB.
- **Datos malformados:** listing que no normaliza se descarta y se cuenta en
  `errors`, sin frenar el lote.
- **Cambios de portal (scraping):** un segmento que devuelve 0 cuando antes traía
  cientos se detecta como anomalía → `partial` + alerta en logs.
- **Listings desaparecidos:** los no vistos en una corrida **exitosa** pasan a
  `is_active=false` (no se borran). Si la corrida falló, no se tocan.
- **UI:** si la DB no responde, error claro y reintentable; nunca pantalla en blanco.

## Estrategia de testing

- **Normalizer (unit, TDD):** por portal, fixtures de payloads crudos reales →
  assert del `NormalizedListing`. Casos sucios: USD vs ARS, año en el título, km
  como "80.000 km", typos de marca.
- **Dedup (unit, TDD):** mismos datos en distintos portales → misma key; autos
  distintos → keys distintas.
- **Connectors (integración, HTTP mockeado):** parseo y paginación; no se pega a
  portales reales en CI.
- **Ingestion runner (integración, Supabase local):** ciclo completo con connector
  fake → upsert, `is_active`, `ingest_runs`; incluye "portal falla → resto sigue".
- **Search API (integración):** DB sembrada → cada filtro (incl. rango de km y
  precio) y paginación keyset.
- **E2E (Playwright, mínimo):** entrar a `/buscar`, filtrar, ver resultados, abrir detalle.

## Criterios de éxito del MVP

1. Una corrida programada ingiere autos de ≥ 2 portales (1 API + 1 scraping) y los
   persiste normalizados en Supabase.
2. La búsqueda devuelve resultados unificados filtrables por todos los campos
   listados, incluyendo rango de km y de precio.
3. Los posibles duplicados cross-portal se agrupan visualmente sin perder datos.
4. La caída de un portal no rompe ni la ingesta ni la búsqueda.
5. El detalle de un aviso linkea al portal original.
