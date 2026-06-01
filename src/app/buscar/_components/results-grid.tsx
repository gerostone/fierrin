import type { ListingRow } from '@/lib/search/query';
import { ListingCard } from './listing-card';

export function ResultsGrid({ groups }: { groups: ListingRow[][] }) {
  if (!groups.length) {
    return <p className="py-16 text-center text-gray-500">Sin resultados para estos filtros.</p>;
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {groups.map((g) => <ListingCard key={g[0].id} group={g} />)}
    </div>
  );
}
