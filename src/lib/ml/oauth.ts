import type { SupabaseClient } from '@supabase/supabase-js';

// Flujo OAuth Authorization Code de MercadoLibre. ML deprecó client_credentials,
// así que autorizamos una vez (vía /api/ml/login) y luego refrescamos el
// access_token con el refresh_token persistido en la tabla oauth_tokens.
const AUTH_BASE = 'https://auth.mercadolibre.com.ar/authorization';
const TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';
const PROVIDER = 'mercadolibre';

export interface MlTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
}

/** URL a la que redirigir al usuario para que autorice la app. */
export function authUrl(state: string): string {
  const p = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.ML_CLIENT_ID ?? '',
    redirect_uri: process.env.ML_REDIRECT_URI ?? '',
    state,
  });
  return `${AUTH_BASE}?${p}`;
}

async function tokenRequest(
  body: Record<string, string>,
  fetchFn: typeof fetch = fetch,
): Promise<MlTokens> {
  const res = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(body),
  });
  if (!res.ok) throw new Error(`ML token error ${res.status}`);
  const j = (await res.json()) as { access_token: string; refresh_token: string; expires_in?: number };
  return {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: Date.now() + (j.expires_in ?? 0) * 1000,
  };
}

/** Canjea el `code` del callback por access + refresh token. */
export function exchangeCode(code: string, fetchFn: typeof fetch = fetch): Promise<MlTokens> {
  return tokenRequest({
    grant_type: 'authorization_code',
    client_id: process.env.ML_CLIENT_ID ?? '',
    client_secret: process.env.ML_CLIENT_SECRET ?? '',
    code,
    redirect_uri: process.env.ML_REDIRECT_URI ?? '',
  }, fetchFn);
}

/** Obtiene un nuevo access_token (y refresh_token rotado) a partir del refresh. */
export function refresh(refreshToken: string, fetchFn: typeof fetch = fetch): Promise<MlTokens> {
  return tokenRequest({
    grant_type: 'refresh_token',
    client_id: process.env.ML_CLIENT_ID ?? '',
    client_secret: process.env.ML_CLIENT_SECRET ?? '',
    refresh_token: refreshToken,
  }, fetchFn);
}

/** Persiste los tokens (una fila por proveedor). */
export async function saveTokens(db: SupabaseClient, t: MlTokens): Promise<void> {
  const { error } = await db.from('oauth_tokens').upsert({
    provider: PROVIDER,
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_at: new Date(t.expires_at).toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'provider' });
  if (error) throw new Error(error.message);
}

// Margen para refrescar antes del vencimiento real y evitar usar un token al límite.
const REFRESH_MARGIN_MS = 60_000;

/**
 * Devuelve un access_token válido: usa el guardado si no está por vencer; si
 * vence dentro del margen, lo refresca y persiste. Lanza si la app no fue
 * autorizada todavía (no hay fila en oauth_tokens).
 */
export async function getValidToken(db: SupabaseClient, fetchFn: typeof fetch = fetch): Promise<string> {
  const { data, error } = await db.from('oauth_tokens')
    .select('*').eq('provider', PROVIDER).single();
  if (error || !data) {
    throw new Error('MercadoLibre no autorizado: visitá /api/ml/login para conectar la cuenta');
  }
  const expMs = new Date(data.expires_at as string).getTime();
  if (expMs > Date.now() + REFRESH_MARGIN_MS) return data.access_token as string;

  const refreshed = await refresh(data.refresh_token as string, fetchFn);
  await saveTokens(db, refreshed);
  return refreshed.access_token;
}
