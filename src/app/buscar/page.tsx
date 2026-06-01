import { createServiceClient } from '@/lib/supabase/server';
import { parseSearchParams } from '@/lib/search/filters';
import { searchListings, groupByDedup } from '@/lib/search/query';
import { FilterBar } from './_components/filter-bar';
import { ResultsGrid } from './_components/results-grid';

export const dynamic = 'force-dynamic';

export default async function BuscarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  const resolved = await searchParams;
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(resolved)) {
    (Array.isArray(v) ? v : [v]).forEach((val) => usp.append(k, val));
  }
  const filters = parseSearchParams(usp);

  let groups: ReturnType<typeof groupByDedup> = [];
  let failed = false;
  try {
    const db = createServiceClient();
    const { items } = await searchListings(db, filters);
    groups = groupByDedup(items);
  } catch {
    failed = true;
  }

  return (
    <div>
      <FilterBar />
      {failed
        ? <p className="py-16 text-center text-red-600">No pudimos cargar los resultados. Probá de nuevo.</p>
        : <ResultsGrid groups={groups} />}
    </div>
  );
}
