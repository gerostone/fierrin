const BRAND_ALIASES: Record<string, string> = {
  vw: 'Volkswagen',
  volkswagen: 'Volkswagen',
  chevy: 'Chevrolet',
};

const PROV_ALIASES: Record<string, string> = {
  'capital federal': 'CABA',
  'ciudad autónoma de buenos aires': 'CABA',
  caba: 'CABA',
};

export function parseKm(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : null;
  const digits = v.replace(/[^\d]/g, '');
  return digits ? parseInt(digits, 10) : null;
}

export function parsePrice(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const digits = v.replace(/[^\d]/g, '');
  return digits ? parseInt(digits, 10) : null;
}

export function normalizeBrand(b: string | null | undefined): string | null {
  if (!b) return null;
  const key = b.trim().toLowerCase();
  if (BRAND_ALIASES[key]) return BRAND_ALIASES[key];
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function normalizeProv(p: string | null | undefined): string | null {
  if (!p) return null;
  const key = p.trim().toLowerCase();
  return PROV_ALIASES[key] ?? p.trim();
}
