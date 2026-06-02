import type { SupabaseClient } from '@supabase/supabase-js';
import type { Connector, Segment, NormalizedListing } from '@/lib/types';
import { computeDedupKey } from '@/lib/dedup';

interface RunDeps {
  db: SupabaseClient; // cliente Supabase (service role) o doble compatible
  connectors: Connector[];
  segments: Segment[];
}

interface RunSummary {
  okRuns: number;
  partialRuns: number;
  errorRuns: number;
  totalUpserted: number;
}

function toRow(n: NormalizedListing, seenAt: string) {
  return {
    source_id: n.sourceId, external_id: n.externalId, url: n.url, title: n.title,
    brand: n.brand, model: n.model, year: n.year, price: n.price, currency: n.currency,
    mileage_km: n.mileageKm, location_prov: n.locationProv, fuel: n.fuel,
    transmission: n.transmission, seller_type: n.sellerType, thumbnail_url: n.thumbnailUrl,
    raw: n.raw, dedup_key: computeDedupKey(n), last_seen_at: seenAt,
    is_active: true,
  };
}

export async function runIngestion(deps: RunDeps): Promise<RunSummary> {
  const summary: RunSummary = { okRuns: 0, partialRuns: 0, errorRuns: 0, totalUpserted: 0 };
  // Marca de inicio: las filas refrescadas en esta corrida tendrán last_seen_at > runStartedAt.
  const runStartedAt = new Date().toISOString();

  for (const connector of deps.connectors) {
    let sawData = false; // hubo al menos un segmento exitoso para este source

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
          rows.push(toRow(n, new Date().toISOString()));
        }
        if (rows.length) {
          const { error } = await deps.db.from('listings')
            .upsert(rows, { onConflict: 'source_id,external_id' });
          if (error) throw new Error(error.message);
        }

        sawData = true;
        const status = errors > 0 ? 'partial' : 'ok';
        await deps.db.from('ingest_runs').update({
          status, finished_at: new Date().toISOString(),
          fetched: raws.length, upserted: rows.length, errors,
        }).eq('id', runId);
        if (status === 'ok') summary.okRuns++; else summary.partialRuns++;
        summary.totalUpserted += rows.length;
      } catch (e) {
        await deps.db.from('ingest_runs').update({
          status: 'error', finished_at: new Date().toISOString(), error_detail: e instanceof Error ? e.message : String(e),
        }).eq('id', runId);
        summary.errorRuns++;
        // seguir con el siguiente connector/segmento
      }
    }

    // Desactivar los avisos de este source que no se volvieron a ver en esta corrida.
    // Sólo si hubo datos frescos: si todos los segmentos fallaron, no tocamos lo existente.
    if (sawData) {
      await deps.db.from('listings').update({ is_active: false })
        .eq('source_id', connector.id).eq('is_active', true)
        .lt('last_seen_at', runStartedAt);
    }
  }
  return summary;
}
