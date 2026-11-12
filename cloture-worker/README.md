# jobalto-cloture (Cloudflare Worker)

Dashboard de clôture Jobalto (onglets 2025 Clôture / 2026 Postes ouverts), servi par un Worker
avec proxy Airtable. Plus aucun token Airtable dans le navigateur.

- URL : https://jobalto-cloture.diego-e9c.workers.dev
- Accès : Cloudflare Access app « Clôture compta — Jobalto » (login Google, policy *Jobalto Staff* = `@jobalto.be`).
  Le Worker revérifie le JWT Access (`cf-access-jwt-assertion`, aud + iss + exp + signature).
- API : `GET /api/records?offset=` (liste paginée, champs whitelistés) · `PATCH /api/records`
  (1 record, seulement Statut / Owner / Notes / Lien / Discussions / MAJ).
- Base `appglh7wfz1QDn8N9`, table `tblna1Xzs6Np66ROd` codées en dur dans `src/index.ts`.
- Auto-refresh 60 s côté page (suspendu pendant une saisie, un menu ouvert ou onglet caché).

## Secret

```bash
npx wrangler secret put AIRTABLE_PAT
```

## Déployer

```bash
npm i && npx wrangler deploy
```

Les pages vivent dans `public/`. Modifier là, pas dans les copies GitHub Pages à la racine du repo.
