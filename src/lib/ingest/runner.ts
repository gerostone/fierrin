import type { Connector, Segment, NormalizedListing } from '@/lib/types';
import { computeDedupKey } from '@/lib/dedup';

interface RunDeps {
  db: any; // cliente Supabase (service role) o doble compatible
  connectors: Connector[];
  segments: Segment[];
}

interface RunSummary {
  okRuns: number;
  partialRuns: number;
  errorRuns: number;
  totalUpserted: number;
}

function toRow(n: NormalizedListing) {
  return {
    source_id: n.sourceId, external_id: n.externalId, url: n.url, title: n.title,
    brand: n.brand, model: n.model, year: n.year, price: n.price, currency: n.currency,
    mileage_km: n.mileageKm, location_prov: n.locationProv, fuel: n.fuel,
    transmission: n.transmission, seller_type: n.sellerType, thumbnail_url: n.thumbnailUrl,
    raw: n.raw, dedup_key: computeDedupKey(n), last_seen_at: new Date().toISOString(),
    is_active: true,
  };
}

export async function runIngestion(deps: RunDeps): Promise<RunSummary> {
  const summary: RunSummary = { okRuns: 0, partialRuns: 0, errorRuns: 0, totalUpserted: 0 };

  for (const connector of deps.connectors) {
    for (const segment of deps.segments) {
      const segLabel = `brand=${segment.brand}&prov=${segment.prov}&price=${segment.priceMin}-${segment.priceMax}`;
      const { data: run } = await deps.db.from('ingest_runs')
        .insert({ source_id: connector.id, segment: segLabel, status: 'running' })
        .select().single();
      const runId = run.id;

      try {
        const raws = await connector.fetchListings(segment);
        const rows = [];
        let errors = 0;
        for (const raw of raws) {
          const n = connector.normalize(raw);
          if (!n) { errors++; continue; }
          rows.push(toRow(n));
        }
        if (rows.length) {
          const { error } = await deps.db.from('listings')
            .upsert(rows, { onConflict: 'source_id,external_id' });
          if (error) throw new Error(error.message);
        }
        const seenIds = rows.map((r) => r.external_id);
        // desactivar los no vistos de este source en esta corrida exitosa
        await deps.db.from('listings').update({ is_active: false })
          .eq('source_id', connector.id).eq('is_active', true)
          .not('external_id', 'in', `(${seenIds.map((s) => `"${s}"`).join(',') || '""'})`);

        const status = errors > 0 ? 'partial' : 'ok';
        await deps.db.from('ingest_runs').update({
          status, finished_at: new Date().toISOString(),
          fetched: raws.length, upserted: rows.length, errors,
        }).eq('id', runId);
        if (status === 'ok') summary.okRuns++; else summary.partialRuns++;
        summary.totalUpserted += rows.length;
      } catch (e: any) {
        await deps.db.from('ingest_runs').update({
          status: 'error', finished_at: new Date().toISOString(), error_detail: String(e?.message ?? e),
        }).eq('id', runId);
        summary.errorRuns++;
        // seguir con el siguiente connector/segmento
      }
    }
  }
  return summary;
}
