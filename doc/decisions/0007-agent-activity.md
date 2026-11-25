# 0007 — Activité des agents

## Contexte

Un agent MCP modifie l’espace de travail : il ouvre des tuiles, les déplace, écrit
dans un document, modifie un tableau. Le journal existant raconte chaque effet,
mais il vit en mémoire, ne les regroupe pas par appel et ne permet pas de revenir
en arrière. La barre de fenêtre n’offre aucun endroit pour lire ni corriger ce
qu’un agent vient de faire.

## Décision

### Timeline par onglet

Un bouton à gauche des modes ouvre un popover qui montre les **30 dernières
étapes de l’onglet actif**. Une étape regroupe les effets d’un même appel MCP
(`op`) : ouverture, action, déplacement, redimensionnement. Les changements de
focus ne sont pas affichés. La marque du client MCP apparaît en tête de chaque
groupe, avec un monogramme pour un client inconnu.

### SQLite plutôt qu’un fichier JSON

L’activité est persistée avec `rusqlite` (`bundled`), dans des tables distinctes
du snapshot du workspace. La [migration vers `spark.db`](../operations/persistence.md#migration-vers-sparkdb) reprend les tables de l’ancienne base `activity.db` :

- le payload d’une étape est un document JSON, mais les colonnes `tab_id`, `at`,
  `kind` et `size` servent aux requêtes et à l’élagage ;
- SQLite donne les transactions, le WAL et `secure_delete` sans écrire un moteur
  de fichiers ;
- le chargement peut être fait par onglet, à la demande ;
- une migration future peut se contenter d’ajouter des colonnes, le payload
  restant tolérant.

Une base documentaire externe (MongoDB, Atlas) a été écartée : pas d’embarqué,
processus et cloud inutiles pour 30 lignes par onglet, et confidentialité locale
des instantanés. Un stockage `IndexedDB` a été écarté pour la même raison de
durabilité et de propriété du dossier de configuration.

### Bornes

- 30 étapes par onglet ;
- 2 Mio par étape, 4 Mio au total ; la plus récente est toujours conservée ;
- une étape trop grosse perd ses instantanés mais reste lisible ;
- effacement explicite depuis le pied du popover ;
- `spark.db` est créé en `0600` sur Unix, avec `secure_delete=ON`.

### Inverses

Chaque effet décrit comment revenir en arrière :

- disposition : ancrage précédent, taille précédente, ou disposition complète
  d’avant ;
- tuile/onglet : fermeture, réouverture avec les données conservées ;
- action qui déclare un inverse : `TileAction.inverse { capture, restore }`,
  fourni par l’extension. Markdown et Données l’implémentent ; le navigateur
  l’utilise pour `navigate`. L’inverse est capturé même quand `mutates` est
  faux : `mutates` ne concerne que la confirmation côté client MCP.

La flèche ouvre un menu : « annuler cette action » rejoue les effets à l’envers,
« revenir à cet instant » restaure la disposition capturée. Une confirmation est
demandée pour les actions mutables, le cycle de vie et les dispositions
anciennes ; une réorganisation récente sans suite est directe.

Une action annulée se disperse puis disparaît de la timeline et de la table d’activité.
Motion anime le balayage et les particules, puis replie la hauteur de la ligne
ou du groupe vide : le reste de la liste et le panneau suivent le même mouvement.
Avec la réduction des animations, seul un bref fondu est joué.
Le marqueur `reverted_at` ne couvre que l’animation ; `activity_load` retire les
lignes restantes au chargement suivant.

La vue groupe par jour et par session : l’icône du client est sur l’en-tête du
groupe, et chaque ligne est indentée avec un fil d’Ariane `onglet › objet`.

## Conséquences

- Le journal reste la source pour le brief et les agents ; l’activité en est une
  projection bornée et persistée.
- Le backend ajoute `activity.rs`, six commandes Tauri, l’événement `mcp:closed`
  et `rusqlite` au binaire.
- `PRAGMA user_version` versionne le schéma SQLite. Le JSON des étapes n’a pas
  de version propre ; le front valide chaque étape au chargement.
- L’attribution par session dépend de `clientInfo` et de la portée asynchrone
  existante. Deux clients simultanés restent une limite documentée ; les effets
  d’un même appel sont regroupés de façon fiable.
- Aucun nouvel outil MCP. Le sidecar conserve une connexion par processus client
  pour que les appels successifs gardent la même session.

## Non retenu

- Un historique inter-onglets ou global.
- Un diff de contenu complet dans la timeline : seuls des résumés bornés sont
  affichés.
- Une restauration de session terminal : rouvrir une tuile Terminal démarre une
  nouvelle session.
- Le chiffrement au repos de la base locale.
