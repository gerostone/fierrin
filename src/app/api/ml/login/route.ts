import { NextResponse } from 'next/server';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { authUrl } from '@/lib/ml/oauth';

export const dynamic = 'force-dynamic';

// Sólo el dueño puede iniciar el flujo: si cualquiera pudiera, un atacante
// autorizaría con SU cuenta y sobrescribiría nuestros tokens. Protegemos con el
// mismo INGEST_SECRET, pasado por ?secret=.
function authorized(req: Request): boolean {
  const secret = process.env.INGEST_SECRET;
  if (!secret) return false;
  const provided = Buffer.from(new URL(req.url).searchParams.get('secret') ?? '');
  const expected = Buffer.from(secret);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
  }
  // state anti-CSRF: lo guardamos en cookie httpOnly y lo verificamos en el callback.
  const state = randomBytes(16).toString('hex');
  const res = NextResponse.redirect(authUrl(state));
  res.cookies.set('ml_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });
  return res;
}
