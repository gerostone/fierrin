import Link from 'next/link';
import type { ListingRow } from '@/lib/search/query';

export function ListingCard({ group }: { group: ListingRow[] }) {
  const main = group[0];
  const others = group.length - 1;
  const price = main.price != null ? `${main.currency === 'USD' ? 'US$' : '$'} ${main.price.toLocaleString('es-AR')}` : 's/precio';
  return (
    <Link href={`/aviso/${main.id}`} className="block rounded-lg border bg-white overflow-hidden hover:shadow-md transition">
      <div className="aspect-video bg-[#e8eef5] flex items-center justify-center text-[#7a8aa0]">
        {main.thumbnail_url ? <img src={main.thumbnail_url} alt={main.title} className="h-full w-full object-cover" /> : 'sin foto'}
      </div>
      <div className="p-3">
        <h3 className="font-medium truncate">{main.title}</h3>
        <div className="text-lg font-bold text-[#1a3a5c]">{price}</div>
        <p className="text-sm text-gray-600">
          {[main.year, main.mileage_km != null ? `${main.mileage_km.toLocaleString('es-AR')} km` : null, main.location_prov].filter(Boolean).join(' · ')}
        </p>
        <div className="mt-1 flex gap-1 text-xs">
          <span className="rounded-full bg-[#eef2f7] px-2 py-0.5">{main.source_id}</span>
          {others > 0 && <span className="rounded-full bg-[#e6f7ec] px-2 py-0.5 text-[#1e8a4c]">También en {others} portal{others > 1 ? 'es' : ''}</span>}
        </div>
      </div>
    </Link>
  );
}
