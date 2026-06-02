import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { mercadolibre } from '@/lib/connectors/mercadolibre';
import type { RawListing, Segment } from '@/lib/types';

const sample = JSON.parse(readFileSync('tests/fixtures/ml-search-sample.json', 'utf8'));

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe('mercadolibre.normalize', () => {
  it('normaliza el primer item del fixture (precio en USD, particular, CABA)', () => {
    const item = sample.results[0];
    const raw: RawListing = { externalId: String(item.id), raw: item };
    const n = mercadolibre.normalize(raw)!;
    expect(n.sourceId).toBe('mercadolibre');
    expect(n.externalId).toBe(String(item.id));
    expect(n.url).toBe(item.permalink);
    expect(n.title).toBe(item.title);
    expect(n.price).toBe(12500);
    expect(n.currency).toBe('USD');
    expect(n.brand).toBe('Volkswagen');
    expect(n.model).toBe('Gol Trend');
    expect(n.year).toBe(2018);
    expect(n.mileageKm).toBe(85000);
    expect(n.fuel).toBe('Nafta');
    expect(n.transmission).toBe('Manual');
    expect(n.sellerType).toBe('particular');
    expect(n.locationProv).toBe('CABA');
  });

  it('normaliza el segundo item (precio en ARS, concesionaria, Córdoba)', () => {
    const item = sample.results[1];
    const n = mercadolibre.normalize({ externalId: String(item.id), raw: item })!;
    expect(n.currency).toBe('ARS');
    expect(n.sellerType).toBe('concesionaria');
    expect(n.locationProv).toBe('Córdoba');
    expect(n.year).toBe(2021);
    expect(n.mileageKm).toBe(32000);
  });

  it('devuelve null si falta id, permalink o price', () => {
    expect(mercadolibre.normalize({ externalId: 'x', raw: { id: 'x', price: 1 } })).toBeNull();
    expect(mercadolibre.normalize({ externalId: 'x', raw: { id: 'x', permalink: 'u' } })).toBeNull();
  });
});

describe('mercadolibre.fetchListings', () => {
  const seg = (over: Partial<Segment> = {}): Segment =>
    ({ brand: 'Volkswagen', prov: 'CABA', priceMin: 0, priceMax: 8000, ...over });

  it('no corre en rangos de precio que no sean el primero (segmentación por marca×prov)', async () => {
    const fetchFn = vi.fn();
    const out = await mercadolibre.fetchListings(seg({ priceMin: 8000, priceMax: 15000 }), {
      token: 'tok', stateId: 'ST', fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(out).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('pagina hasta agotar resultados y agrega Authorization + state', async () => {
    const page1 = { results: Array.from({ length: 50 }, (_, i) => ({ id: `A${i}` })) };
    const page2 = { results: Array.from({ length: 10 }, (_, i) => ({ id: `B${i}` })) };
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(jsonResponse(page1))
      .mockResolvedValueOnce(jsonResponse(page2));
    const out = await mercadolibre.fetchListings(seg(), {
      token: 'tok', stateId: 'ST', fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(out).toHaveLength(60);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toContain('q=Volkswagen');
    expect(url).toContain('state=ST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('lanza si una página devuelve un status no ok', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}, false, 401));
    await expect(
      mercadolibre.fetchListings(seg(), { token: 't', stateId: 'ST', fetchFn: fetchFn as unknown as typeof fetch }),
    ).rejects.toThrow(/401/);
  });
});
