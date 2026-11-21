# 0002 — Page Store et navigation

## Statut

Accepté.

## Contexte

Le premier Store était un dialog dans le rail. Il manquait d’espace, ne permettait pas une découverte éditoriale et masquait le workspace sans le fermer proprement. Il fallait aussi éviter qu’une page remplace le layout et démonte dockview : une session terminal mourrait.

## Décision

- Le Store est une **page overlay** au-dessus de `spark-surface`, qui reste monté et devient `inert`.
- Le Store occupe toute la largeur, avec une sidebar flottante.
- Le retour d’une fiche revient à la vue d’origine (`Découvrir`, `Installées`, `Sources`), pas systématiquement à l’accueil.
- Une galerie de dépôt est une route distincte, accessible depuis Sources ; ajouter un dépôt ouvre sa galerie.
- Les étagères utilisent des fractions entières de largeur pour ne jamais couper une carte.
- Les captures ne sont ni dans les cartes ni dans le hero ; elles restent dans la fiche.

## Conséquences

- Le workspace garde ses sessions et son état pendant que le Store est ouvert.
- Cliquer un onglet ferme le Store.
- La sidebar indique la vue d’origine, y compris quand une fiche est ouverte.
- Le bouton Extensions du rail et la palette ouvrent le Store.
- La navigation est locale au Store ; il n’y a pas d’URL.

Voir [le Store](../extensions/store.md).
