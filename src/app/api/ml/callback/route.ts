import { NextResponse } from 'next/server';
import { exchangeCode, saveTokens } from '@/lib/ml/oauth';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// Leemos la cookie del header crudo para no depender de APIs específicas de versión.
function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expected = readCookie(req, 'ml_oauth_state');

  if (!code || !state || !expected || state !== expected) {
    return NextResponse.json({ error: 'state inválido o code faltante' }, { status: 400 });
  }

  const tokens = await exchangeCode(code);
  await saveTokens(createServiceClient(), tokens);

  const res = NextResponse.json({
    ok: true,
    message: 'MercadoLibre autorizado. Ya podés correr la ingesta.',
  });
  // limpiamos la cookie de state (un solo uso)
  res.cookies.set('ml_oauth_state', '', { maxAge: 0, path: '/' });
  return res;
}
