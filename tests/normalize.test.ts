import { describe, it, expect } from 'vitest';
import { parseKm, parsePrice, normalizeBrand, normalizeProv } from '@/lib/normalize';

describe('parseKm', () => {
  it('parsea "80.000 km"', () => expect(parseKm('80.000 km')).toBe(80000));
  it('parsea número crudo', () => expect(parseKm(80000)).toBe(80000));
  it('devuelve null si no hay dígitos', () => expect(parseKm('s/d')).toBeNull());
});

describe('parsePrice', () => {
  it('parsea "$ 14.500"', () => expect(parsePrice('$ 14.500')).toBe(14500));
  it('devuelve null para vacío', () => expect(parsePrice('')).toBeNull());
});

describe('normalizeBrand', () => {
  it('mapea alias VW a Volkswagen', () => expect(normalizeBrand('vw')).toBe('Volkswagen'));
  it('capitaliza marca desconocida', () => expect(normalizeBrand('renault')).toBe('Renault'));
});

describe('normalizeProv', () => {
  it('mapea Capital Federal a CABA', () => expect(normalizeProv('Capital Federal')).toBe('CABA'));
  it('mapea "Ciudad Autónoma de Buenos Aires" a CABA', () =>
    expect(normalizeProv('Ciudad Autónoma de Buenos Aires')).toBe('CABA'));
  it('mapea variante sin "de" a CABA', () =>
    expect(normalizeProv('Ciudad Autónoma Buenos Aires')).toBe('CABA'));
  it('mapea variante sin acento a CABA', () =>
    expect(normalizeProv('Ciudad Autonoma de Buenos Aires')).toBe('CABA'));
  it('mapea "C.A.B.A." a CABA', () => expect(normalizeProv('C.A.B.A.')).toBe('CABA'));
  it('tolera espacios extra y mayúsculas', () =>
    expect(normalizeProv('  CIUDAD   AUTONOMA  BUENOS  AIRES ')).toBe('CABA'));
  it('devuelve la provincia tal cual si ya es canónica', () => expect(normalizeProv('Córdoba')).toBe('Córdoba'));
});
