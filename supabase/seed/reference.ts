export const BRANDS = ['Volkswagen', 'Toyota', 'Ford', 'Chevrolet', 'Renault', 'Peugeot', 'Fiat'];
export const PROVINCES = ['CABA', 'Buenos Aires', 'Córdoba', 'Santa Fe', 'Mendoza'];
// Rangos de precio en USD para subdividir y no topar el límite de paginación.
export const PRICE_RANGES: Array<[number, number]> = [
  [0, 8000], [8000, 15000], [15000, 25000], [25000, 1_000_000],
];
