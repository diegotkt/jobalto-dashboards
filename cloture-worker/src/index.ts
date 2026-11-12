interface Env {
  ASSETS: Fetcher;
  AIRTABLE_PAT: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
}

const AIRTABLE = 'https://api.airtable.com/v0/appglh7wfz1QDn8N9/tblna1Xzs6Np66ROd';

// Champs lus par la page (cf. const F dans public/*.html)
const READ_FIELDS = [
  'fldcSJwvAZtCwUUK0', 'fldMlvU6ESB1c202m', 'fldfkDQuiXo0GPgDl', 'fldow5LqIkU3iWVrQ',
  'fldpI6JBOXUMe3mJI', 'fld2oU3Cl1lq13642', 'fldEOcOXx9xYzAE0U', 'fldaE4qvJum78fVFS',
  'fldV0VqBuT1LUBdBX', 'fldHiX4kzgZGnyNEx', 'fldXlD9MKqqkFftGE', 'fld2qB50smVNwCgDZ',
  'fldF3f3YHjwZ7oOxj', 'fldK44SYKtdpEbwy0', 'fldGOhX6lupzV1kV2', 'fldy3avqATcMH6fhf',
];
// Champs que la page écrit : Statut, Owner, Notes, MAJ, Lien, Discussions
const WRITE_FIELDS = new Set([
  'fldaE4qvJum78fVFS', 'fldV0VqBuT1LUBdBX', 'fldHiX4kzgZGnyNEx',
  'fldXlD9MKqqkFftGE', 'fld2qB50smVNwCgDZ', 'fldK44SYKtdpEbwy0',
]);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

// ---- Cloudflare Access JWT (RS256, JWKS de l'équipe) ----
let jwks: { keys: (JsonWebKey & { kid: string })[]; at: number } | null = null;

async function getKey(env: Env, kid: string): Promise<CryptoKey | null> {
  if (!jwks || Date.now() - jwks.at > 3600_000 || !jwks.keys.some(k => k.kid === kid)) {
    const r = await fetch(`${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
    jwks = { keys: ((await r.json()) as any).keys, at: Date.now() };
  }
  const jwk = jwks.keys.find(k => k.kid === kid);
  return jwk ? crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']) : null;
}

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

export async function verifyAccess(req: Request, env: Env): Promise<string | null> {
  const token = req.headers.get('cf-access-jwt-assertion');
  if (!token) return null;
  const [h, p, sig] = token.split('.');
  if (!h || !p || !sig) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64url(h)));
    const payload = JSON.parse(new TextDecoder().decode(b64url(p)));
    if (header.alg !== 'RS256') return null;
    const key = await getKey(env, header.kid);
    if (!key) return null;
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(sig), new TextEncoder().encode(`${h}.${p}`));
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    const now = Date.now() / 1000;
    if (!ok || !aud.includes(env.ACCESS_AUD) || payload.iss !== env.ACCESS_TEAM_DOMAIN || payload.exp < now) return null;
    return payload.email || 'unknown';
  } catch {
    return null;
  }
}

async function airtable(env: Env, url: string, init?: RequestInit) {
  const r = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${env.AIRTABLE_PAT}`, 'content-type': 'application/json' },
  });
  // Pas de passthrough de 401/403 Airtable : le client les lirait comme "session expirée"
  const status = r.status === 401 || r.status === 403 ? 502 : r.status;
  return new Response(r.body, { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

async function api(req: Request, env: Env, email: string): Promise<Response> {
  if (req.method === 'GET') {
    const q = new URLSearchParams({ pageSize: '100', returnFieldsByFieldId: 'true' });
    const offset = new URL(req.url).searchParams.get('offset');
    if (offset) q.set('offset', offset);
    for (const f of READ_FIELDS) q.append('fields[]', f);
    return airtable(env, `${AIRTABLE}?${q}`);
  }
  if (req.method === 'PATCH') {
    let body: any;
    try { body = await req.json(); } catch { return json({ error: 'JSON invalide' }, 400); }
    const recs = body?.records;
    if (!Array.isArray(recs) || recs.length !== 1) return json({ error: 'Un seul enregistrement par requête' }, 400);
    const { id, fields } = recs[0] ?? {};
    if (typeof id !== 'string' || !/^rec[A-Za-z0-9]{14}$/.test(id)) return json({ error: 'id invalide' }, 400);
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return json({ error: 'fields invalide' }, 400);
    const bad = Object.keys(fields).filter(k => !WRITE_FIELDS.has(k));
    if (bad.length) return json({ error: `Champ non modifiable : ${bad.join(', ')}` }, 400);
    if (Object.values(fields).some(v => v !== null && typeof v !== 'string')) return json({ error: 'Valeurs texte uniquement' }, 400);
    console.log(JSON.stringify({ patch: id, by: email, fields: Object.keys(fields) }));
    return airtable(env, `${AIRTABLE}?returnFieldsByFieldId=true`, {
      method: 'PATCH',
      body: JSON.stringify({ records: [{ id, fields }] }),
    });
  }
  return json({ error: 'Méthode non autorisée' }, 405);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    // Défense en profondeur : Access protège déjà la route, le Worker revérifie le JWT.
    const email = await verifyAccess(req, env);
    if (!email) return new Response('Accès refusé', { status: 403 });

    const url = new URL(req.url);
    if (url.pathname === '/api/records') return api(req, env, email);
    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);
    if (url.pathname === '/') return Response.redirect(new URL('/2026-05-04-cloture-2025.html', url).toString(), 302);
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
