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
          update: () => ({ eq: () => ({ eq: () => ({ not: async () => ({ error: null }) }) }) }),
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
