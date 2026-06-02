import { createServiceClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function AvisoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = createServiceClient();
  const { data } = await db.from('listings').select('*').eq('id', id).single();
  if (!data) notFound();
  const price = data.price != null ? `${data.currency === 'USD' ? 'US$' : '$'} ${Number(data.price).toLocaleString('es-AR')}` : 's/precio';
  return (
    <article className="max-w-2xl">
      <h1 className="text-2xl font-bold">{data.title}</h1>
      <div className="mt-1 text-xl font-bold text-[#1a3a5c]">{price}</div>
      <ul className="mt-4 grid grid-cols-2 gap-2 text-sm text-gray-700">
        <li>Año: {data.year ?? 's/d'}</li>
        <li>Km: {data.mileage_km != null ? Number(data.mileage_km).toLocaleString('es-AR') : 's/d'}</li>
        <li>Provincia: {data.location_prov ?? 's/d'}</li>
        <li>Combustible: {data.fuel ?? 's/d'}</li>
        <li>Transmisión: {data.transmission ?? 's/d'}</li>
        <li>Vendedor: {data.seller_type ?? 's/d'}</li>
        <li>Portal: {data.source_id}</li>
      </ul>
      <a href={data.url} target="_blank" rel="noopener noreferrer"
         className="mt-6 inline-block rounded bg-[#1a3a5c] px-5 py-2 text-white">
        Ver publicación original
      </a>
    </article>
  );
}
