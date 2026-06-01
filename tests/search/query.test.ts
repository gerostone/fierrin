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
