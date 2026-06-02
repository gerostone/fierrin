import { describe, it, expect, beforeEach, vi } from 'vitest';
import { authUrl, exchangeCode, refresh, getValidToken, saveTokens } from '@/lib/ml/oauth';
import type { SupabaseClient } from '@supabase/supabase-js';

beforeEach(() => {
  process.env.ML_CLIENT_ID = 'cid';
  process.env.ML_CLIENT_SECRET = 'csec';
  process.env.ML_REDIRECT_URI = 'http://localhost:3000/api/ml/callback';
});

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe('authUrl', () => {
  it('arma la URL de autorización con response_type=code, client_id, redirect_uri y state', () => {
    const u = new URL(authUrl('xyz'));
    expect(u.origin + u.pathname).toBe('https://auth.mercadolibre.com.ar/authorization');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('client_id')).toBe('cid');
    expect(u.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/ml/callback');
    expect(u.searchParams.get('scope')).toContain('offline_access');
    expect(u.searchParams.get('state')).toBe('xyz');
  });
});

describe('exchangeCode', () => {
  it('canjea el code y mapea expires_in a expires_at', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({ access_token: 'at', refresh_token: 'rt', expires_in: 21600 }),
    );
    const before = Date.now();
    const t = await exchangeCode('the-code', fetchFn as unknown as typeof fetch);
    expect(t.access_token).toBe('at');
    expect(t.refresh_token).toBe('rt');
    expect(t.expires_at).toBeGreaterThanOrEqual(before + 21600 * 1000);

    // verifica el cuerpo enviado
    const [, init] = fetchFn.mock.calls[0];
    const body = new URLSearchParams(init.body as string);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('the-code');
    expect(body.get('client_id')).toBe('cid');
    expect(body.get('client_secret')).toBe('csec');
  });

  it('lanza si la respuesta no es ok', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}, false, 400));
    await expect(exchangeCode('x', fetchFn as unknown as typeof fetch)).rejects.toThrow(/400/);
  });
});

describe('refresh', () => {
  it('usa grant_type=refresh_token', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({ access_token: 'at2', refresh_token: 'rt2', expires_in: 21600 }),
    );
    const t = await refresh('old-rt', fetchFn as unknown as typeof fetch);
    expect(t.access_token).toBe('at2');
    const [, init] = fetchFn.mock.calls[0];
    const body = new URLSearchParams(init.body as string);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('old-rt');
  });
});

// --- Fake Supabase client para getValidToken / saveTokens ---
function fakeDb(row: Record<string, unknown> | null) {
  const upserts: Array<Record<string, unknown>> = [];
  const db = {
    upserts,
    from() {
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: row, error: row ? null : { message: 'no row' } }),
          }),
        }),
        upsert: async (payload: Record<string, unknown>) => {
          upserts.push(payload);
          return { error: null };
        },
      };
    },
  };
  return db;
}

describe('getValidToken', () => {
  it('devuelve el access_token guardado si todavía no está por vencer', async () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    const db = fakeDb({ access_token: 'cached', refresh_token: 'rt', expires_at: future });
    const fetchFn = vi.fn();
    const token = await getValidToken(db as unknown as SupabaseClient, fetchFn as unknown as typeof fetch);
    expect(token).toBe('cached');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('refresca y persiste cuando el access_token está vencido', async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const db = fakeDb({ access_token: 'old', refresh_token: 'the-rt', expires_at: past });
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({ access_token: 'fresh', refresh_token: 'new-rt', expires_in: 21600 }),
    );
    const token = await getValidToken(db as unknown as SupabaseClient, fetchFn as unknown as typeof fetch);
    expect(token).toBe('fresh');
    expect(db.upserts).toHaveLength(1);
    expect(db.upserts[0].provider).toBe('mercadolibre');
    expect(db.upserts[0].access_token).toBe('fresh');
    expect(db.upserts[0].refresh_token).toBe('new-rt');
  });

  it('lanza un error claro si no hay token guardado (no autorizado)', async () => {
    const db = fakeDb(null);
    await expect(
      getValidToken(db as unknown as SupabaseClient, (vi.fn()) as unknown as typeof fetch),
    ).rejects.toThrow(/autoriz/i);
  });
});

describe('saveTokens', () => {
  it('hace upsert con onConflict provider', async () => {
    const db = fakeDb(null);
    await saveTokens(db as unknown as SupabaseClient, {
      access_token: 'a', refresh_token: 'r', expires_at: Date.now() + 1000,
    });
    expect(db.upserts).toHaveLength(1);
    expect(db.upserts[0].provider).toBe('mercadolibre');
  });
});
