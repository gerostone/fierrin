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

describe('provinceFromLocation (vía normalize)', () => {
  const provOf = (location: string | undefined) =>
    deautos.normalize({
      externalId: 'x',
      raw: { make: 'Ford', model: 'Focus', listing_url: 'https://x', location },
    })!.locationProv;

  it('toma la provincia del último segmento', () => expect(provOf('Palermo, CABA')).toBe('CABA'));
  it('descarta "Argentina" y usa el segmento anterior', () =>
    expect(provOf('Rosario, Santa Fe, Argentina')).toBe('Santa Fe'));
  it('devuelve null si solo aparece el país', () => expect(provOf('Argentina')).toBeNull());
  it('devuelve null si el último segmento está vacío', () => expect(provOf('Centro, ')).toBeNull());
  it('devuelve null para location vacío', () => expect(provOf('')).toBeNull());
  it('devuelve null para location ausente', () => expect(provOf(undefined)).toBeNull());
  it('ignora el paréntesis "(A.M.B.A.)"', () =>
    expect(provOf('Vicente López, Buenos Aires (A.M.B.A.)')).toBe('Buenos Aires'));
  it('devuelve null si ningún segmento es provincia', () =>
    expect(provOf('Barrio Norte, Algún Lugar')).toBeNull());
});
