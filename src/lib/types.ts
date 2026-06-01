export type Currency = 'ARS' | 'USD';
export type SellerType = 'particular' | 'concesionaria';

/** Listing crudo tal como lo devuelve un connector, sin normalizar. */
export interface RawListing {
  externalId: string;
  raw: unknown;          // payload original del portal
}

/** Listing normalizado: única forma que conoce el resto del sistema. */
export interface NormalizedListing {
  sourceId: string;
  externalId: string;
  url: string;
  title: string;
  brand: string | null;
  model: string | null;
  year: number | null;
  price: number | null;
  currency: Currency | null;
  mileageKm: number | null;
  locationProv: string | null;
  fuel: string | null;
  transmission: string | null;
  sellerType: SellerType | null;
  thumbnailUrl: string | null;
  raw: unknown;
  dedupKey?: string;
}

/** Un segmento del catálogo a recorrer (marca × provincia × rango de precio). */
export interface Segment {
  brand: string;
  prov: string;
  priceMin: number;
  priceMax: number;
}

export interface Connector {
  id: string;
  type: 'api' | 'scrape';
  /** Devuelve listings crudos del segmento. Lanza si el fetch falla irrecuperablemente. */
  fetchListings(segment: Segment): Promise<RawListing[]>;
  /** Normaliza un raw de ESTE portal. Devuelve null si es inválido/descartable. */
  normalize(raw: RawListing): NormalizedListing | null;
}
