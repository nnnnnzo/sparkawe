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

## Déploiement

Projet Vercel `sparkawe`, importé depuis `nnnnnzo/sparkawe` avec **Root
Directory** réglé sur `site`. Astro est détecté automatiquement ; aucune
configuration Vercel n'est nécessaire. `@vercel/analytics` est monté dans
`Base.astro` : mesure sans cookie, uniquement des pages vues.

## Règles de fond

- Ne pas afficher de sceau « certifié » : aucune signature n'est vérifiée.
- Ne pas annoncer de binaire signé ni de canal de mise à jour : il n'y en a pas.
- Ne pas promettre Windows : le pont MCP n'y fonctionne pas encore.
- Les captures ne sont jamais retouchées ; le contenu affiché doit être réel.
