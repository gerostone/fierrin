-- Tokens OAuth por proveedor (una fila por proveedor, ej. 'mercadolibre').
-- Guardamos el refresh_token de larga vida y el access_token vigente; el
-- access se renueva con getValidToken() cuando está por vencer.
create table oauth_tokens (
  provider      text primary key,
  access_token  text not null,
  refresh_token text not null,
  expires_at    timestamptz not null,
  updated_at    timestamptz not null default now()
);
