import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { CONNECTORS } from '@/lib/connectors';
import { generateSegments } from '@/lib/ingest/segments';
import { runIngestion } from '@/lib/ingest/runner';
import { BRANDS, PROVINCES, PRICE_RANGES } from '../../../../../supabase/seed/reference';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

function authorized(req: Request): boolean {
  const secret = process.env.INGEST_SECRET;
  if (!secret) return false; // sin secreto configurado, el endpoint queda cerrado
  const provided = Buffer.from(req.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

async function handle(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
  }
  const db = createServiceClient();
  const segments = generateSegments({ brands: BRANDS, provinces: PROVINCES, priceRanges: PRICE_RANGES });
  const summary = await runIngestion({ db, connectors: Object.values(CONNECTORS), segments });
  return NextResponse.json(summary);
}

// Vercel Cron dispara GET; el disparo manual usa POST. Ambos comparten auth + lógica.
export const GET = handle;
export const POST = handle;
