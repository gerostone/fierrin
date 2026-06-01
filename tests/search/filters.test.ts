import { describe, it, expect } from 'vitest';
import { parseSearchParams } from '@/lib/search/filters';

describe('parseSearchParams', () => {
  it('parsea rangos numéricos y multiselect', () => {
    const f = parseSearchParams(new URLSearchParams(
      'brand=Volkswagen&brand=Ford&km_min=0&km_max=100000&price_min=5000&price_max=20000&currency=USD&page_price=10000&page_id=abc'
    ));
    expect(f.brand).toEqual(['Volkswagen', 'Ford']);
    expect(f.kmMin).toBe(0);
    expect(f.kmMax).toBe(100000);
    expect(f.currency).toBe('USD');
    expect(f.cursor).toEqual({ price: 10000, id: 'abc' });
  });

  it('ignora valores inválidos sin romper', () => {
    const f = parseSearchParams(new URLSearchParams('km_min=abc&year_min=1800'));
    expect(f.kmMin).toBeUndefined();
    expect(f.yearMin).toBe(1800); // se acepta; el filtro simplemente no matcheará
  });
});
