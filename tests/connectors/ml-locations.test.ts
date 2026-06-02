import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resolveStateId, __resetLocationsCache } from '@/lib/connectors/ml-locations';

const PAYLOAD = {
  id: 'AR',
  name: 'Argentina',
  states: [
    { id: 'TUxBUENBUGw3M2E1', name: 'Capital Federal' },
    { id: 'TUxBUFBST3Zob2Jh', name: 'Córdoba' },
    { id: 'TUxBUEdSQWVjdWFy', name: 'Buenos Aires' },
  ],
};

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

beforeEach(() => __resetLocationsCache());

describe('resolveStateId', () => {
  it('mapea una provincia canónica a su ID de estado de ML', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(PAYLOAD));
    const id = await resolveStateId('Córdoba', fetchFn as unknown as typeof fetch);
    expect(id).toBe('TUxBUFBST3Zob2Jh');
  });

  it('pliega el nombre de ML "Capital Federal" a nuestra CABA', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(PAYLOAD));
    const id = await resolveStateId('CABA', fetchFn as unknown as typeof fetch);
    expect(id).toBe('TUxBUENBUGw3M2E1');
  });

  it('cachea: no vuelve a hacer fetch en la segunda llamada', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(PAYLOAD));
    await resolveStateId('Córdoba', fetchFn as unknown as typeof fetch);
    await resolveStateId('Buenos Aires', fetchFn as unknown as typeof fetch);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('devuelve null para una provincia que no resuelve', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(PAYLOAD));
    const id = await resolveStateId('Pais Vasco', fetchFn as unknown as typeof fetch);
    expect(id).toBeNull();
  });
});
