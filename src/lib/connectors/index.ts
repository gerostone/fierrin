import type { Connector } from '@/lib/types';
import { deautos } from './deautos';

// mercadolibre se agrega en Task 7 (requiere credenciales de la API de ML).
export const CONNECTORS: Record<string, Connector> = {
  deautos,
};
