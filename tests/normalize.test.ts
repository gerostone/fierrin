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
  it('pliega variante sin acento a la forma canónica', () =>
    expect(normalizeProv('Cordoba')).toBe('Córdoba'));
  it('pliega "Tucuman" a "Tucumán"', () => expect(normalizeProv('Tucuman')).toBe('Tucumán'));
  it('pliega "Neuquen" a "Neuquén"', () => expect(normalizeProv('Neuquen')).toBe('Neuquén'));
  it('pliega "Rio Negro" a "Río Negro"', () => expect(normalizeProv('Rio Negro')).toBe('Río Negro'));
  it('pliega "entre rios" (minúsculas) a "Entre Ríos"', () =>
    expect(normalizeProv('entre rios')).toBe('Entre Ríos'));
  it('preserva provincias sin acento que ya son canónicas', () =>
    expect(normalizeProv('Mendoza')).toBe('Mendoza'));
  it('devuelve tal cual una provincia desconocida', () =>
    expect(normalizeProv('Patagonia')).toBe('Patagonia'));
});
