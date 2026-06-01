import { describe, it, expect } from 'vitest';
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

// Doble del cliente DB: registra upserts, runs y desactivaciones en memoria.
function makeFakeDb() {
  const upserts: any[] = [];
  const runs: any[] = [];
  const deactivations: string[] = []; // source_id por cada llamada de desactivación
  return {
    upserts, runs, deactivations,
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
          update: () => ({ eq: (col: string, val: string) => ({ eq: () => ({ lt: async () => { if (col === 'source_id') deactivations.push(val); return { error: null }; } }) }) }),
        };
      }
      throw new Error('tabla inesperada ' + table);
    },
  };
}

const seg2: Segment = { brand: 'Ford', prov: 'Córdoba', priceMin: 8000, priceMax: 15000 };

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

  it('desactiva una sola vez por source tras todos sus segmentos', async () => {
    const db = makeFakeDb();
    await runIngestion({
      db: db as any,
      connectors: [makeConnector('deautos', 'ok')],
      segments: [seg, seg2], // dos segmentos: la desactivación NO debe correr por segmento
    });
    expect(db.upserts.length).toBe(2);              // un upsert por segmento
    expect(db.deactivations).toEqual(['deautos']);  // una sola desactivación, no una por segmento
  });

  it('no desactiva un source cuyos segmentos fallaron todos', async () => {
    const db = makeFakeDb();
    await runIngestion({
      db: db as any,
      connectors: [makeConnector('mercadolibre', 'throw')],
      segments: [seg, seg2],
    });
    expect(db.deactivations).toEqual([]); // sin datos frescos, no se toca lo existente
  });
});
