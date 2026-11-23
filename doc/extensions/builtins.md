# Extensions intégrées

Les intégrées vivent dans `src/extensions/<nom>/`. Chacune a un `manifest.ts`, un `index.tsx`, des styles et, si nécessaire, une API de coopération.

| Extension | Id | Niveau | Tuiles | Contrats |
|---|---|---|---|---|
| Terminal | `spark.terminal` | core | `terminal.session` | `terminal.open@1`, `terminal.sessions@1`, `terminal.session.closed` |
| Markdown | `spark.markdown` | core | `markdown.editor`, `markdown.preview` | `markdown.open@1`, `markdown.documents@1`, `markdown.document.saved` |
| Données | `spark.data` | core | `data.table`, `data.chart` | `data.tables@1`, `data.charts@1`, `data.table.changed` |
| Explorateur | `spark.explorer` | core | `explorer.tree` | utilise `markdown.open@1` et `terminal.open@1` |
| Aperçu | `spark.preview` | core | `preview.pdf` | `preview.pdf@1` |
| OpenAlex | `spark.openalex` | official | `openalex.search`, `openalex.work` | utilise `preview.pdf@1` |
| Navigateur web | `spark.web` | core | `web.page` | `web.open@1` |

## Terminal

- PTY natif Rust (`terminal_*`), zsh sur macOS/Linux.
- Session liée à la tuile : elle meurt si la tuile est démontée.
- `terminal.open@1` permet aux autres extensions d’ouvrir un terminal dans un dossier.
- Windows : terminal indisponible, message explicite.
- Capture : `src/extensions/terminal/media/terminal.webp` (16:9).

## Markdown

- Éditeur CodeMirror, aperçu `react-markdown` + GFM.
- `markdown.open@1` ouvre un fichier ; `markdown.documents@1` expose le texte et les sauvegardes.
- `canClose` demande confirmation si le document est modifié.
- Accès disque via les commandes `markdown_*` et les grants de chemins.
- Captures : `markdown-editor.webp` et `markdown-preview.webp`.

## Données

- Tableau typé : texte, nombre, date ; import TSV/CSV, plafonds de lignes/colonnes.
- Graphiques liés à un tableau : barres, lignes, aires, points.
- `data.tables@1` expose la liste des tableaux ; `data.charts@1` ouvre un graphique.
- Tout est dans la fenêtre, sans commande native.
- Captures : `data-table.webp` et `data-chart.webp`.

## Explorateur

- Arborescence d’un dossier choisi, avec grants persistés.
- Ouvre un Markdown via `markdown.open@1`, un terminal via `terminal.open@1`.
- Commandes natives `explorer_*` ; pas d’accès hors du dossier autorisé.
- Capture : `explorer.webp` (arborescence + aperçu Markdown).

## Aperçu

- PDF téléchargé via `pdf_fetch`, cache local, rendu pdf.js.
- `preview.pdf@1` permet à OpenAlex d’ouvrir un PDF libre.
- `pdf_probe` vérifie qu’une URL sert un PDF avant téléchargement.
- Capture : `preview.webp`.

## OpenAlex

- Recherche et fiches de travaux via l’API OpenAlex (CORS, sans clé).
- Peut ouvrir le PDF libre dans Aperçu via `preview.pdf@1` ; action indisponible si Aperçu est inactif.
- Aucune commande native propre.
- Captures : `openalex-search.webp` et `openalex-work.webp`.

## Navigateur web

- Une page par tuile, rendue par une vue web native posée sur le rectangle mesuré de la tuile.
- Barre minimale : précédent, suivant, recharger, adresse éditable, chargement.
- L’onglet de la tuile prend le titre de la page (via `tabTitle`), et retombe sur « Navigateur web » tant qu’il n’y en a pas.
- `web.open@1` permet aux autres extensions d’ouvrir une adresse.
- Un lien « nouvelle fenêtre », un `window.open` ou un **clic molette sur un lien** ouvrent une tuile en onglet dans le groupe de la tuile d’origine.
- Adresses `https://` uniquement ; téléchargements refusés ; session persistante (profil `web/profile/` sous Windows et Linux, magasin WebKit de l’application sous macOS).
- L’apparence est imposée à la vue web elle-même (`NSAppearance`) selon le thème de Spark : les pages qui honorent `prefers-color-scheme` passent en sombre avec le thème sombre, sans dépendre du réglage du système. La page apparaît et s’efface en fondu quand la tuile revient ou se masque.
- Aucun média ne démarre tout seul dans une page ouverte ou restaurée : il faut un geste réel dans la page (l’autoplay natif de wry est neutralisé, voir [la décision 0005](../decisions/0005-browser-tile.md)).
- Les coins bas de la vue sont arrondis comme le groupe Dockview ; un média en cours de lecture survit à un déplacement ou à une annulation de disposition.
- La surface expose l’adresse, le titre et l’état de chargement, jamais le contenu. `read_text` renvoie au plus 6 000 caractères et le chemin du texte complet.
- Six vues natives au maximum, les autres sont suspendues puis rouvertes à leur adresse.
- Linux : indisponible jusqu’au correctif amont du positionnement des vues enfants (tauri#10420).
- Captures : habillage seulement (barre et état vide), jamais une page factice. Voir [la décision 0005](../decisions/0005-browser-tile.md).

## Coopération
Une extension qui dépend d’un service doit le déclarer :

```ts
import { previewPdf } from "../preview/api.ts";

actions: {
  open_pdf: {
    title: "Lire le PDF",
    requires: [previewPdf],
    run: (tile) => { /* … */ },
  },
}
```

Si Aperçu est désactivé, l’action n’est pas proposée. Les événements et services sont globaux ; préfixer les identifiants.

## Captures

Les captures sont des images **1280×720** (16:9), générées depuis les vraies vues React, en thème sombre, avec des données neutres. Elles ne sont affichées que dans la galerie de la fiche. Voir [le Store](store.md).
