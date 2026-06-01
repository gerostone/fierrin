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
