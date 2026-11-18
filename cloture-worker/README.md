# jobalto-cloture (Cloudflare Worker)

Dashboard Jobalto « 2026 Postes ouverts » (la page 2025 Clôture a été retirée), servi par un Worker
avec proxy Airtable. Plus aucun token Airtable dans le navigateur.

- URL : https://jobalto-cloture.diego-e9c.workers.dev
- Accès : Cloudflare Access app « Clôture compta — Jobalto » (login Google, policy réutilisable *Jobalto Adminsitrators* = diego@ + alex@).
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

## Dépôt de factures (PJ)

Dans le détail d'un poste, la zone « Glisse ici les factures » accepte PDF/PNG/JPG (≤ 5 Mo). `POST /api/pj` :
1. lit fournisseur, réf., date, montant TTC via Workers AI (`toMarkdown` pour les PDF texte, Llama 4 Scout vision pour les images) ;
2. cherche une ligne « Manquante » du poste dans la table **Lignes Virginie 2026** (`tblB9pMLjESSBS1hK`) au même montant (sinon ±2 % / 1 € pour les frais de change, marqué ≈) ;
3. attache le fichier au poste et à la ligne trouvée, passe la ligne en « Reçue » ;
4. envoie le fichier à OkiOki (`OKIOKI_TO`) depuis `factures@mcpjobalto.com` (Cloudflare Email Sending, nécessite Workers Paid).

Anti-doublon : même nom + même taille déjà en PJ du poste → 409, pas de second envoi.
Limites : PDF scannés sans texte refusés (déposer une capture PNG).

**Lignes Virginie** : importées depuis la balance du 31/10/26. À chaque nouvelle balance, ajouter les nouvelles lignes, mettre à jour « Vue dans balance du », et passer en « Archivée » les lignes absentes.
