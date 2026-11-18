interface Env {
  ASSETS: Fetcher;
  AIRTABLE_PAT: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  AI: Ai;
  EMAIL: SendEmail;
  OKIOKI_TO: string;
  MAIL_FROM: string;
}

const BASE = 'appglh7wfz1QDn8N9';
const AIRTABLE = `https://api.airtable.com/v0/${BASE}/tblna1Xzs6Np66ROd`;
const LINES = `https://api.airtable.com/v0/${BASE}/tblB9pMLjESSBS1hK`;
const POSTE_PJ = 'fldGOhX6lupzV1kV2';
// Table « Lignes Virginie 2026 »
const L = {
  LIBELLE: 'fldb089WWgNR6i8Fs', POSTE: 'fldF8ajWOyTfO5fzE', DATE: 'fldsrgQwaZ89UxkcL', MONTANT: 'fldf94jxumvePEpQH',
  REF: 'fldTu1Uk4HYEF9b1b', STATUT: 'fld08hl1oIpFqlAed', PIECE: 'fldLOqecwYBEGioh3', EXTRACTION: 'fld0v8XunqgHy2XN4',
};
const MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';
const MAX_FILE = 5 * 1024 * 1024; // limite upload Airtable
const TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg']);

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

async function at(env: Env, url: string, init?: RequestInit): Promise<any> {
  const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${env.AIRTABLE_PAT}`, 'content-type': 'application/json' } });
  const body: any = await r.json();
  if (!r.ok) throw new Error(`Airtable ${r.status} ${body?.error?.message || body?.error?.type || ''}`);
  return body;
}

async function allLines(env: Env): Promise<any[]> {
  const out: any[] = []; let offset = '';
  do {
    const q = new URLSearchParams({ pageSize: '100', returnFieldsByFieldId: 'true' });
    for (const f of [L.LIBELLE, L.POSTE, L.DATE, L.MONTANT, L.REF, L.STATUT, L.PIECE]) q.append('fields[]', f);
    if (offset) q.set('offset', offset);
    const d = await at(env, `${LINES}?${q}`);
    out.push(...d.records); offset = d.offset || '';
  } while (offset);
  return out;
}

const b64 = (buf: ArrayBuffer) => {
  const u = new Uint8Array(buf); let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};

type Extract = { fournisseur: string | null; ref: string | null; date: string | null; montant: number | null };

const PROMPT = `Tu lis une facture fournisseur belge. Réponds UNIQUEMENT en JSON :
{"fournisseur": string|null, "ref": string|null (numéro de facture), "date": "YYYY-MM-DD"|null (date de facture), "montant": number|null (total TTC à payer, en euros, point décimal)}`;

async function extract(env: Env, file: File, buf: ArrayBuffer): Promise<Extract> {
  let messages: any[];
  if (file.type === 'application/pdf') {
    const md: any = await env.AI.toMarkdown({ name: file.name, blob: new Blob([buf], { type: file.type }) });
    const text = (md?.data || '').trim();
    // ponytail: pas d'OCR pour les PDF scannés — l'utilisateur peut déposer une capture PNG à la place
    if (!text) throw new Error('PDF sans texte (scan ?) — dépose une capture PNG à la place');
    messages = [{ role: 'system', content: PROMPT }, { role: 'user', content: text.slice(0, 15000) }];
  } else {
    messages = [{ role: 'system', content: PROMPT }, { role: 'user', content: [
      { type: 'text', text: 'Voici la facture.' },
      { type: 'image_url', image_url: { url: `data:${file.type};base64,${b64(buf)}` } },
    ] }];
  }
  const r: any = await env.AI.run(MODEL as any, { messages, response_format: { type: 'json_object' }, max_tokens: 300, temperature: 0 } as any);
  let o: any = r?.response;
  if (typeof o === 'string') o = JSON.parse(o.slice(o.indexOf('{'), o.lastIndexOf('}') + 1));
  const num = typeof o?.montant === 'string' ? parseFloat(o.montant.replace(/\s/g, '').replace(',', '.')) : o?.montant;
  return {
    fournisseur: o?.fournisseur || null,
    ref: o?.ref ? String(o.ref) : null,
    date: /^\d{4}-\d{2}-\d{2}$/.test(o?.date || '') ? o.date : null,
    montant: Number.isFinite(num) ? Math.round(num * 100) / 100 : null,
  };
}

// Ligne « Manquante » du poste au même montant ; départage : réf. puis date la plus proche.
// Sinon ligne la plus proche à ±2 % / 1 € (frais de change carte, ex. Canva 34,03 → 34,53) — marquée approx.
export function matchLine(lines: any[], x: Extract): { line: any; approx: boolean } | null {
  if (x.montant == null) return null;
  const diff = (l: any) => Math.abs(Math.abs(l.fields[L.MONTANT] ?? 0) - x.montant!);
  const c = lines.filter(l => diff(l) < 0.005);
  if (!c.length) {
    const near = lines.filter(l => diff(l) <= Math.max(1, x.montant! * 0.02)).sort((a, b) => diff(a) - diff(b))[0];
    return near ? { line: near, approx: true } : null;
  }
  return { line: pick(c, x), approx: false };
}

function pick(c: any[], x: Extract): any {
  if (c.length === 1) return c[0];
  const norm = (s: string) => s.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const byRef = x.ref ? c.find(l => l.fields[L.REF] && norm(l.fields[L.REF]).includes(norm(x.ref!))) : null;
  if (byRef) return byRef;
  const t = x.date ? Date.parse(x.date) : NaN;
  return isNaN(t) ? c[0] : c.sort((a, b) => Math.abs(Date.parse(a.fields[L.DATE]) - t) - Math.abs(Date.parse(b.fields[L.DATE]) - t))[0];
}

async function uploadAttachment(env: Env, recordId: string, fieldId: string, file: File, buf: ArrayBuffer) {
  return at(env, `https://content.airtable.com/v0/${BASE}/${recordId}/${fieldId}/uploadAttachment`, {
    method: 'POST', body: JSON.stringify({ contentType: file.type, file: b64(buf), filename: file.name }),
  });
}

async function depot(req: Request, env: Env, email: string): Promise<Response> {
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  const recordId = String(form?.get('recordId') || '');
  if (!/^rec[A-Za-z0-9]{14}$/.test(recordId)) return json({ error: 'recordId invalide' }, 400);
  if (!(file instanceof File) || !TYPES.has(file.type)) return json({ error: 'PDF, PNG ou JPG uniquement' }, 400);
  if (file.size > MAX_FILE) return json({ error: 'Fichier > 5 Mo' }, 400);
  const buf = await file.arrayBuffer();

  const poste = await at(env, `${AIRTABLE}/${recordId}?returnFieldsByFieldId=true`);
  const nom = poste.fields?.fldfkDQuiXo0GPgDl || '';
  // Anti-doublon : même nom + même taille déjà en PJ du poste → pas de second envoi OkiOki
  if ((poste.fields?.[POSTE_PJ] || []).some((a: any) => a.filename === file.name && a.size === file.size))
    return json({ error: 'Déjà déposée sur ce poste' }, 409);

  const x = await extract(env, file, buf);
  const lines = (await allLines(env)).filter(l => (l.fields[L.POSTE] || []).includes(recordId) && l.fields[L.STATUT] === 'Manquante');
  const m = matchLine(lines, x);
  const line = m?.line;
  const resume = `${x.date || '?'} · ${x.montant ?? '?'} € · réf. ${x.ref || '?'} · ${file.name} (déposé par ${email})${m?.approx ? ' — montant approché' : ''}`;

  await uploadAttachment(env, recordId, POSTE_PJ, file, buf);
  if (line) {
    await uploadAttachment(env, line.id, L.PIECE, file, buf);
    await at(env, LINES, { method: 'PATCH', body: JSON.stringify({ records: [{ id: line.id, fields: { [L.STATUT]: 'Reçue', [L.EXTRACTION]: resume } }] }) });
  }

  let emailed = false, emailError = '';
  try {
    await env.EMAIL.send({
      from: { email: env.MAIL_FROM, name: 'Jobalto Clôture' }, to: env.OKIOKI_TO, replyTo: email,
      subject: `Facture d'achat — ${x.fournisseur || nom}${x.ref ? ' — ' + x.ref : ''}`,
      text: `Facture d'achat ${nom} : ${resume}`,
      attachments: [{ content: b64(buf), filename: file.name, type: file.type, disposition: 'attachment' }],
    });
    emailed = true;
  } catch (e: any) { emailError = String(e?.message || e); }

  console.log(JSON.stringify({ depot: recordId, by: email, file: file.name, montant: x.montant, line: line?.id || null, emailed }));
  return json({ extraction: x, line: line ? { id: line.id, date: line.fields[L.DATE], montant: line.fields[L.MONTANT], ref: line.fields[L.REF] || null, approx: m!.approx } : null, emailed, emailError });
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
    return airtable(env, AIRTABLE, {
      method: 'PATCH',
      // en écriture, Airtable lit returnFieldsByFieldId dans le body (ignoré en query)
      body: JSON.stringify({ records: [{ id, fields }], returnFieldsByFieldId: true }),
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
    try {
      if (url.pathname === '/api/lines' && req.method === 'GET') return json({ records: await allLines(env) });
      if (url.pathname === '/api/pj' && req.method === 'POST') return await depot(req, env, email);
    } catch (e: any) {
      return json({ error: String(e?.message || e) }, 502);
    }
    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);
    if (url.pathname === '/') return Response.redirect(new URL('/postes-ouverts-2026.html', url).toString(), 302);
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
