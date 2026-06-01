import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseDeautosJson, deautos } from '@/lib/connectors/deautos';

const json = readFileSync('tests/fixtures/deautos-listing.json', 'utf8');

describe('parseDeautosJson', () => {
  it('extrae listings con campos clave normalizados', () => {
    const raws = parseDeautosJson(json);
    expect(raws.length).toBeGreaterThan(0);
    const n = deautos.normalize(raws[0])!;
    expect(n.sourceId).toBe('deautos');
    expect(n.externalId).toBeTruthy();
    expect(n.url).toMatch(/^https?:\/\//);
    expect(n.title).toBeTruthy();
    expect(n.currency).toBe('USD');
    expect(n.price).toBeGreaterThan(0);
    expect(n.brand).toBeTruthy();
  });

  it('externalId es estable y único por aviso (listing_url puede repetirse)', () => {
    const raws = parseDeautosJson(json);
    const ids = new Set(raws.map((r) => r.externalId));
    expect(ids.size).toBe(raws.length);
  });

  it('deriva la provincia desde el campo location', () => {
    const raws = parseDeautosJson(json);
    const provs = raws.map((r) => deautos.normalize(r)!.locationProv);
    expect(provs).toContain('CABA');
  });

  it('JSON inválido o forma inesperada => array vacío', () => {
    expect(parseDeautosJson('not json')).toEqual([]);
    expect(parseDeautosJson('{"not":"an array"}')).toEqual([]);
  });
});
