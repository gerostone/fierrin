import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { parseSearchParams } from '@/lib/search/filters';
import { searchListings, groupByDedup } from '@/lib/search/query';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const filters = parseSearchParams(new URL(req.url).searchParams);
  const db = createServiceClient();
  const { items, nextCursor } = await searchListings(db, filters);
  return NextResponse.json({ groups: groupByDedup(items), nextCursor });
}
