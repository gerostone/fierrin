# Arquitectura de Fierrin

Deep dive técnico del MVP. Para puesta en marcha, scripts y referencia de API ver el [README](../README.md).

---

## Índice

- [Principio rector: una sola forma de dato](#principio-rector-una-sola-forma-de-dato)
- [El connector como unidad de extensión](#el-connector-como-unidad-de-extensión)
- [Pipeline de ingesta](#pipeline-de-ingesta)
- [Segmentación](#segmentación)
- [Normalización](#normalización)
- [Deduplicación por cubetas](#deduplicación-por-cubetas)
- [Búsqueda y paginación keyset](#búsqueda-y-paginación-keyset)
- [Cómo agregar un connector nuevo](#cómo-agregar-un-connector-nuevo)
- [Decisiones de diseño y trade-offs](#decisiones-de-diseño-y-trade-offs)

---

## Principio rector: una sola forma de dato

Cada portal expone los autos en su propio formato (JSON propietario, HTML, API REST...). Si esa heterogeneidad se filtrara al resto del sistema, cada feature tendría que conocer cada portal.

Para evitarlo, hay **una única estructura canónica**, `NormalizedListing` (`src/lib/types.ts`), y un contrato de traducción, `Connector`. Todo lo que está **río abajo** de la normalización —dedup, persistencia, búsqueda, UI— **solo conoce `NormalizedListing`**. Todo lo específico de un portal vive **dentro de su connector**.

```
portal A (JSON)  ─┐
portal B (HTML)  ─┼─▶  Connector.normalize()  ─▶  NormalizedListing  ─▶  resto del sistema
portal C (API)   ─┘            (lo único que sabe de cada portal)
```

Consecuencia práctica: **agregar un portal = escribir un `Connector`**. No se toca el runner, ni el dedup, ni la búsqueda, ni la UI.

---

## El connector como unidad de extensión

```ts
export interface Connector {
  id: string;                  // ej. 'deautos' — debe existir en la tabla sources
  type: 'api' | 'scrape';
  fetchListings(segment: Segment): Promise<RawListing[]>; // trae raws de un segmento
  normalize(raw: RawListing): NormalizedListing | null;   // traduce; null = descartar
}
```

- **`fetchListings`** recibe un `Segment` (marca + provincia + rango de precio) y devuelve `RawListing[]` (payload crudo + un `externalId` estable). Lanza si el fetch falla irrecuperablemente — el runner lo aísla.
- **`normalize`** traduce **un** raw de **ese** portal a `NormalizedListing`, o devuelve `null` si el aviso es inválido/descartable (sin URL, sin marca, etc.).

Los connectors activos se registran en `src/lib/connectors/index.ts`:

```ts
export const CONNECTORS: Record<string, Connector> = { deautos };
```

---

## Pipeline de ingesta

`runIngestion(deps)` en `src/lib/ingest/runner.ts` orquesta la corrida. Estructura en dos bucles anidados — **por connector, por segmento**:

```
runStartedAt = now()                      // marca de inicio de la corrida

para cada connector:
  sawData = false
  para cada segmento:
    insert ingest_runs (status=running)   // auditoría; si falla, se saltea el segmento
    try:
      raws  = connector.fetchListings(segment)
      rows  = raws.map(normalize).filter(no-null)   // null cuenta como error
      upsert(rows) on conflict (source_id, external_id)   // refresca last_seen_at
      sawData = true
      update ingest_runs (status = errors>0 ? 'partial' : 'ok', contadores)
    catch e:
      update ingest_runs (status='error', error_detail=e)   // NO corta el bucle

  si sawData:                             // desactivación, una vez por connector
    listings.update(is_active=false)
      .eq(source_id, connector.id).eq(is_active, true)
      .lt(last_seen_at, runStartedAt)
```

### Tres invariantes que importan

1. **Aislamiento de fallas.** El `try/catch` está **por segmento**. Si un portal se cae a mitad de la corrida, ese segmento queda en `error` y la corrida sigue con el resto. Un portal caído no tira abajo a los demás.

2. **Desactivación una sola vez, al final del connector.** Las publicaciones que ya no aparecen se marcan `is_active=false`. Esto se hace **después de recorrer todos los segmentos** del connector, comparando contra `runStartedAt` (capturado **una vez** al inicio).
   > ⚠️ **Por qué no por-segmento:** una versión previa desactivaba dentro del bucle de segmentos, scopeando solo por `source_id`. Como cada segmento veía solo una porción del catálogo, cada uno desactivaba lo que los segmentos anteriores habían insertado → solo sobrevivía el último segmento. La corrección fue mover la desactivación afuera y compararla contra `runStartedAt`. Hay tests de regresión que lo fijan (`tests/ingest/runner.test.ts`).

3. **No borrar ante caída total.** La desactivación está guardada por `sawData`: si **todos** los segmentos de un connector fallaron, no se toca su catálogo existente (una caída transitoria no debe vaciar la búsqueda).

### Idempotencia

El `upsert` usa la restricción única `(source_id, external_id)`. Reingestar es seguro: actualiza filas existentes y refresca `last_seen_at` en vez de duplicar.

---

## Segmentación

`generateSegments(ref)` (`src/lib/ingest/segments.ts`) produce el producto cartesiano:

```
marcas × provincias × rangos_de_precio
```

Con la referencia de `supabase/seed/reference.ts`:

- **7 marcas**: VW, Toyota, Ford, Chevrolet, Renault, Peugeot, Fiat
- **5 provincias** de alta densidad: CABA, Buenos Aires, Córdoba, Santa Fe, Mendoza
- **4 rangos** de precio USD: `[0,8k)`, `[8k,15k)`, `[15k,25k)`, `[25k,1M)`

→ **140 segmentos**.

**Por qué segmentar:** los portales paginan y muchas veces topan a unos miles de resultados por consulta. Subdividir el catálogo en cortes chicos asegura recorrerlo entero sin chocar contra ese tope. Cada segmento es además la unidad de aislamiento de fallas y de auditoría (`ingest_runs`).

---

## Normalización

`src/lib/normalize.ts` provee helpers puros y testeables que los connectors usan:

| Helper | Qué hace |
|--------|----------|
| `parseKm` / `parsePrice` | extraen el entero de strings sucios (`"81.000 km"` → `81000`) |
| `normalizeBrand` | aplica alias (`vw`→`Volkswagen`, `chevy`→`Chevrolet`) y capitaliza |
| `normalizeProv` | pliega variantes de tipeo a la forma canónica de la provincia |
| `canonicalProv` | como `normalizeProv` pero devuelve `null` si no es una de las 24 jurisdicciones (filtra país/basura) |

**Plegado de provincias (`foldProvKey`):** las claves de alias se guardan en forma plegada —minúsculas, sin acentos, sin puntuación, espacios colapsados— y se generan a partir de la lista canónica `PROVINCES_CANONICAL`. Así `"Cordoba"`, `"CÓRDOBA"`, `"córdoba"` resuelven todas a `"Córdoba"` sin enumerar cada par a mano. CABA suma alias que no derivan de su nombre (`"capital federal"`, `"ciudad autónoma de buenos aires"`).

---

## Deduplicación por cubetas

`computeDedupKey(listing)` (`src/lib/dedup.ts`) genera una clave que **agrupa el mismo auto publicado en distintos portales**, tolerando pequeñas diferencias de precio y kilometraje.

```ts
kmBucket    = round(mileageKm / 5000)                       // cubetas de 5.000 km
priceBucket = round(log(price) / log(1 + 0.10))            // cubetas ~10% (escala log)
key         = sha1( [brand, model, year, kmBucket, priceBucket, prov].join('|').toLowerCase() )[:16]
```

- **Cubetas y no valores exactos:** dos avisos del mismo auto rara vez coinciden al peso en km/precio. Las cubetas absorben esa variación: 5.000 km y ~10% de precio.
- **Escala logarítmica en el precio:** un 10% pesa distinto en USD 5.000 que en USD 50.000. El bucket log mantiene el ancho relativo constante en todo el rango.
- **Devuelve `null`** si falta información clave (marca, modelo, año, precio, km o provincia) o si el precio es ≤ 0. Las claves nulas **no** se agrupan: cada aviso queda individual.

En la búsqueda, `groupByDedup` colapsa los resultados de una página por `dedup_key`; la card muestra "También en N portales" cuando el grupo tiene más de uno.

> **Nota:** el dedup opera sobre la página de resultados, no globalmente en la DB. Es coherente con la UX (agrupar lo que el usuario ve) y barato.

---

## Búsqueda y paginación keyset

`searchListings(db, filters)` (`src/lib/search/query.ts`) arma la consulta a Supabase aplicando los filtros de `SearchFilters` y ordena/pagina.

### Por qué keyset y no offset

La paginación por `OFFSET` se degrada en tablas grandes (el motor descarta N filas en cada página) y es inconsistente si llegan inserts entre páginas. La paginación **keyset** usa el último valor visto como ancla:

```sql
-- orden por precio ascendente, desempate por id
ORDER BY price ASC, id ASC
-- "siguiente página": todo lo que viene después del cursor (price, id)
WHERE price > :cursor_price
   OR (price = :cursor_price AND id > :cursor_id)
LIMIT 25                      -- PAGE_SIZE (24) + 1 para saber si hay más
```

Hay un índice dedicado `(price, id)` (`idx_listings_keyset`) que lo hace eficiente. Se piden `PAGE_SIZE + 1` filas: si vuelven 25, hay página siguiente y se emite `nextCursor` con la fila 24.

### Limitación actual

Solo el orden por **precio** tiene cursor keyset funcional. Los órdenes `year` / `km` / `new` ordenan por su columna + `id` pero **no** emiten `nextCursor` (devuelven la primera página). Está documentado como pendiente en el [roadmap](../README.md#roadmap).

### Construcción de filtros y seguridad

Los filtros se aplican con el query builder de `supabase-js` (`.eq`, `.in`, `.gte`, `.lte`, `.ilike`), que parametriza los valores. El cliente service-role vive **solo en el server** (`src/lib/supabase/server.ts`); nunca llega a un client component.

---

## Cómo agregar un connector nuevo

Ejemplo: agregar un portal ficticio `autofoo`.

### 1. Registrar el source en la DB

En una nueva migración (`supabase/migrations/000X_seed_autofoo.sql`):

```sql
insert into sources (id, name, type, enabled)
values ('autofoo', 'AutoFoo', 'scrape', true);
```

Aplicar con `npx supabase db reset` (local) o la migración correspondiente.

### 2. Escribir el connector

`src/lib/connectors/autofoo.ts`:

```ts
import type { Connector, RawListing, NormalizedListing, Segment } from '@/lib/types';
import { normalizeBrand, canonicalProv, parseKm, parsePrice } from '@/lib/normalize';

interface AutofooRaw { /* forma cruda del portal */ }

function normalize(raw: RawListing): NormalizedListing | null {
  const d = raw.raw as AutofooRaw;
  if (/* falta algo clave */ false) return null;
  return {
    sourceId: 'autofoo',
    externalId: raw.externalId,
    url: /* ... */,
    title: /* ... */,
    brand: normalizeBrand(/* ... */),
    model: /* ... */,
    year: /* ... */,
    price: parsePrice(/* ... */),
    currency: 'USD',           // o 'ARS'
    mileageKm: parseKm(/* ... */),
    locationProv: canonicalProv(/* ... */),
    fuel: null, transmission: null, sellerType: null,
    thumbnailUrl: null,
    raw: d,
  };
}

async function fetchListings(segment: Segment): Promise<RawListing[]> {
  // 1. pedir datos al portal para este segmento
  // 2. derivar un externalId ESTABLE (si el id/URL del portal no es único,
  //    hashear campos como en deautos: externalIdFor)
  // 3. devolver RawListing[]; lanzar si el fetch falla
  return [];
}

export const autofoo: Connector = { id: 'autofoo', type: 'scrape', fetchListings, normalize };
```

### 3. Registrarlo

`src/lib/connectors/index.ts`:

```ts
import { autofoo } from './autofoo';
export const CONNECTORS: Record<string, Connector> = { deautos, autofoo };
```

### 4. Testear

Crear `tests/connectors/autofoo.test.ts` con un fixture real capturado (ver `tests/fixtures/deautos-listing.json` y `tests/connectors/deautos.test.ts` como modelo). Verificar al menos: campos normalizados correctos, `externalId` estable y único, provincia derivada, y entrada inválida → descartada.

**Eso es todo.** El runner lo recorre automáticamente, el dedup lo agrupa con los demás portales y la búsqueda lo incluye. No hay que tocar nada más.

### Patrones útiles (del connector de deautos)

- **`externalId` estable cuando el portal no da uno único:** hashear un compuesto de campos (`sha1([make,model,year,version,km,location,price].join('|'))[:16]`). La URL del listado no siempre sirve.
- **`Promise.allSettled`** al traer múltiples fuentes/archivos: una que falle no tumba al resto.
- **Filtrar al segmento** dentro de `fetchListings` si la fuente es un dump estático, para no devolver los mismos avisos en cada uno de los 140 segmentos.
- **`canonicalProv`** para no guardar país ni basura en `location_prov`.

---

## Decisiones de diseño y trade-offs

| Decisión | Por qué | Trade-off |
|----------|---------|-----------|
| Normalización en el borde (connector) | Aísla lo específico del portal; el resto es agnóstico | Cada connector repite el mapeo de campos |
| Dedup por cubetas + hash | Agrupa el mismo auto pese a diferencias chicas | Cubetas mal calibradas pueden unir/separar de más |
| Dedup sobre la página, no global | Coherente con la UX y barato | No hay vista global de duplicados |
| Keyset sobre `(price, id)` | Estable y eficiente en tablas grandes | Solo implementado para el orden por precio |
| Segmentación marca×prov×precio | Recorrer catálogos grandes sin topar paginación | 140 corridas por ingesta (más filas en `ingest_runs`) |
| `upsert` idempotente + soft-delete (`is_active`) | Reingesta segura; historial preservado | La tabla acumula filas inactivas |
| Service-role solo en server | El secreto nunca llega al cliente | Toda lectura/escritura pasa por el server |

### Pendientes conocidos (ver [roadmap](../README.md#roadmap))

- MercadoLibre: connector + OAuth Authorization Code (`lib/ml/oauth.ts`, `lib/connectors/mercadolibre.ts`, rutas `/api/ml/login` y `/api/ml/callback`) ya implementados, testeados con mocks y con **autorización end-to-end funcionando** (token + refresh persistidos en `oauth_tokens`; la app de ML necesita el flujo *Refresh Token* habilitado y una Redirect URI https pública). **Bloqueo de ML:** con OAuth válido, `/sites/MLA/search` e `/items` devuelven `403 PA_UNAUTHORIZED_RESULT_FROM_POLICIES` (`blocked_by: PolicyAgent`) para apps estándar — sólo responden metadata (`/categories/*`) y `/users/me`. El connector queda fuera del registro (`ML_ENABLED`) hasta que ML apruebe el acceso a búsqueda/items; recién entonces se reemplaza el fixture sintético por una captura real y se verifican campos/atributos y el ID de categoría.
- Keyset para órdenes `year` / `km` / `new`.
- Lock para evitar que una ingesta manual concurrente con el cron se pise la desactivación.
