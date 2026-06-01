create table sources (
  id      text primary key,
  name    text not null,
  type    text not null check (type in ('api','scrape')),
  enabled boolean not null default true
);

create table listings (
  id             uuid primary key default gen_random_uuid(),
  source_id      text not null references sources(id),
  external_id    text not null,
  url            text not null,
  title          text not null,
  brand          text,
  model          text,
  year           int,
  price          numeric,
  currency       text check (currency in ('ARS','USD')),
  mileage_km     int,
  location_prov  text,
  fuel           text,
  transmission   text,
  seller_type    text check (seller_type in ('particular','concesionaria')),
  thumbnail_url  text,
  raw            jsonb,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  is_active      boolean not null default true,
  dedup_key      text,
  unique (source_id, external_id)
);

create index idx_listings_brand     on listings (brand);
create index idx_listings_model     on listings (model);
create index idx_listings_year      on listings (year);
create index idx_listings_price     on listings (price);
create index idx_listings_mileage   on listings (mileage_km);
create index idx_listings_prov      on listings (location_prov);
create index idx_listings_dedup     on listings (dedup_key);
create index idx_listings_active    on listings (is_active);
create index idx_listings_keyset    on listings (price, id);

create table ingest_runs (
  id           uuid primary key default gen_random_uuid(),
  source_id    text not null,
  segment      text not null,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text not null check (status in ('running','ok','partial','error')),
  fetched      int not null default 0,
  upserted     int not null default 0,
  errors       int not null default 0,
  error_detail text
);
