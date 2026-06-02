import type { Connector } from '@/lib/types';
import { deautos } from './deautos';
import { mercadolibre } from './mercadolibre';

// MercadoLibre bloquea por política (PolicyAgent 403) el acceso de apps estándar
// a /sites/MLA/search e /items: el OAuth funciona, pero ML no sirve listings hasta
// que la app obtiene acceso aprobado a esos recursos. Mantenemos el conector listo
// pero fuera del registro hasta que ML habilite el acceso; activarlo con ML_ENABLED=true.
const ML_ENABLED = process.env.ML_ENABLED === 'true';

export const CONNECTORS: Record<string, Connector> = {
  deautos,
  ...(ML_ENABLED ? { mercadolibre } : {}),
};
