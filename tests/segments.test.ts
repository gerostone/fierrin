import { describe, it, expect } from 'vitest';
import { generateSegments } from '@/lib/ingest/segments';

describe('generateSegments', () => {
  it('produce brand × prov × priceRange', () => {
    const segs = generateSegments({
      brands: ['Volkswagen', 'Ford'],
      provinces: ['CABA'],
      priceRanges: [[0, 8000], [8000, 15000]],
    });
    expect(segs).toHaveLength(2 * 1 * 2);
    expect(segs).toContainEqual({ brand: 'Volkswagen', prov: 'CABA', priceMin: 0, priceMax: 8000 });
  });

  it('cada segmento tiene priceMin < priceMax', () => {
    const segs = generateSegments({ brands: ['Toyota'], provinces: ['Córdoba'], priceRanges: [[8000, 15000]] });
    for (const s of segs) expect(s.priceMin).toBeLessThan(s.priceMax);
  });
});
