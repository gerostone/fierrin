import type { Segment } from '@/lib/types';

interface RefData {
  brands: string[];
  provinces: string[];
  priceRanges: Array<[number, number]>;
}

export function generateSegments(ref: RefData): Segment[] {
  const out: Segment[] = [];
  for (const brand of ref.brands) {
    for (const prov of ref.provinces) {
      for (const [priceMin, priceMax] of ref.priceRanges) {
        out.push({ brand, prov, priceMin, priceMax });
      }
    }
  }
  return out;
}
