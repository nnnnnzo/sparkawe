# Site Spark

Site public de Spark : <https://sparkawe.vercel.app>. Il vit dans `site/`, avec
son propre `package.json` et son propre verrou. Aucun workspace npm : le paquet
du site ne partage pas les dépendances de l'application.

## Développement

```sh
cd site
npm install
npm run dev
```

Le serveur écoute sur <http://localhost:4321>. `npm run build` exécute
`astro check` puis génère `dist/`. `npm run preview` sert le build local.

## Langues

- anglais à la racine (`/`), français sous `/fr/` ;
- `prefixDefaultLocale: false`, `trailingSlash: "always"`, sortie statique ;
- les textes des deux langues sont dans `src/data/copy.ts` ; une page ne doit
  pas contenir de copie en dur ;
- chaque page déclare son `canonical` et ses deux `hreflang` via `Base.astro`.

## Contenu

- `src/components/Landing.astro` : la page d'accueil, partagée par les deux
  langues ;
- `src/components/AgentMark.astro` : tracé ou monogramme d'un agent ;
- `src/data/agents.ts` : miroir de `src/shared/agents/index.tsx`. Si la liste
  des agents reconnus change dans l'application, la mettre à jour ici ;
- `src/assets/screens/workspace.png` : capture de la fenêtre Spark, thème
  sombre. C'est une vraie session, pas une maquette ;
- `public/og.png` : image de partage 1200 × 630 ;
- `public/fonts/montserrat-300.woff2` : sous-ensemble latin, servi localement.

## Documentation

`/docs/` (et `/fr/docs/`) est une documentation pour développeurs, en sept pages : fonctionnement,
compilation, espace de travail, pont MCP, SDK d'extension, paquets et dépôts, modèle de confiance.

- La navigation et les résumés sont dans `src/data/docs.ts` ; ajouter une page, c'est ajouter une
  entrée dans les deux langues, puis le fichier dans `src/pages/docs/` et `src/pages/fr/docs/`.
- Les pages utilisent `layouts/Docs.astro`, qui rend la colonne latérale, le sommaire précédent /
  suivant et les liens `hreflang`.
- Le contenu décrit le code réel. Quand un contrat change, mettre à jour la page ici **et** le
  document correspondant dans `doc/` du dépôt.
- Les blocs de code sont des constantes de frontmatter rendues dans `<pre><code>{...}</code></pre>`,
  pour éviter d'avoir à échapper les accolades dans le template.
- Pas de remplissage : une page dit ce que fait le code, ses limites et où regarder ensuite.

## Déploiement

Projet Vercel `sparkawe`, importé depuis `nnnnnzo/sparkawe` à la racine du
dépôt. Le fichier `vercel.json` à la racine décrit le build du site :

```json
{
  "installCommand": "npm --prefix site ci",
  "buildCommand": "npm --prefix site run build",
  "outputDirectory": "site/dist"
}
```

`trailingSlash` est activé pour coller aux URL du site (`/docs/`), et `/_astro`
et `/fonts` sont servis en cache immuable. Inutile de régler un Root Directory :
la racine fonctionne telle quelle. `@vercel/analytics` est monté dans
`Base.astro` : mesure sans cookie, uniquement des pages vues.

## Règles de fond

- Ne pas afficher de sceau « certifié » : aucune signature n'est vérifiée.
- Ne pas annoncer de binaire signé ni de canal de mise à jour : il n'y en a pas.
- Ne pas promettre Windows : le pont MCP n'y fonctionne pas encore.
- Les captures ne sont jamais retouchées ; le contenu affiché doit être réel.
