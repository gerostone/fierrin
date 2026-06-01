export const BRANDS = ['Volkswagen', 'Toyota', 'Ford', 'Chevrolet', 'Renault', 'Peugeot', 'Fiat'];
// Subconjunto de alta densidad usado para segmentar la ingesta (no la lista completa).
export const PROVINCES = ['CABA', 'Buenos Aires', 'Córdoba', 'Santa Fe', 'Mendoza'];
// Forma canónica (con acentos) de las 24 jurisdicciones argentinas. Fuente única para
// plegar variantes sin acento al normalizar provincias (ver normalizeProv).
export const PROVINCES_CANONICAL = [
  'CABA',
  'Buenos Aires',
  'Catamarca',
  'Chaco',
  'Chubut',
  'Córdoba',
  'Corrientes',
  'Entre Ríos',
  'Formosa',
  'Jujuy',
  'La Pampa',
  'La Rioja',
  'Mendoza',
  'Misiones',
  'Neuquén',
  'Río Negro',
  'Salta',
  'San Juan',
  'San Luis',
  'Santa Cruz',
  'Santa Fe',
  'Santiago del Estero',
  'Tierra del Fuego',
  'Tucumán',
];
// Rangos de precio en USD para subdividir y no topar el límite de paginación.
export const PRICE_RANGES: Array<[number, number]> = [
  [0, 8000], [8000, 15000], [15000, 25000], [25000, 1_000_000],
];
