import { createHash } from 'node:crypto';
import type { NormalizedListing } from '@/lib/types';

const KM_BUCKET = 5000;
const PRICE_BUCKET_RATIO = 0.1; // buckets relativos del 10%

/** Agrupa posibles duplicados cross-portal. null si falta info clave. */
export function computeDedupKey(l: NormalizedListing): string | null {
  if (!l.brand || !l.model || l.year == null || l.price == null || l.mileageKm == null || !l.locationProv) {
    return null;
  }
  const kmBucket = Math.round(l.mileageKm / KM_BUCKET);
  const priceBucket = Math.round(Math.log(l.price) / Math.log(1 + PRICE_BUCKET_RATIO));
  const parts = [l.brand, l.model, l.year, kmBucket, priceBucket, l.locationProv]
    .join('|')
    .toLowerCase();
  return createHash('sha1').update(parts).digest('hex').slice(0, 16);
}
