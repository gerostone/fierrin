insert into sources (id, name, type, enabled) values
  ('mercadolibre', 'MercadoLibre', 'api', true),
  ('deautos',      'deautos.com',  'scrape', true)
on conflict (id) do nothing;
