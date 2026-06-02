import type { Connector } from '@/lib/types';
import { deautos } from './deautos';
import { mercadolibre } from './mercadolibre';

export const CONNECTORS: Record<string, Connector> = {
  deautos,
  mercadolibre,
};
