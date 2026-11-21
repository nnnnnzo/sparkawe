# 0003 — Captures d’extensions

## Statut

Accepté.

## Contexte

Les premières cartes du Store utilisaient des dégradés, des filigranes et des maquettes qui donnaient un rendu générique. Le Store doit montrer le produit réel, pas une illustration inventée.

## Décision

- Les captures sont produites depuis les **vraies vues React** des extensions.
- Format **1280×720, 16:9**, WebP, thème sombre.
- Les intégrées ont une capture, ou deux quand elles ont plusieurs tuiles (Markdown, Données, OpenAlex).
- Une fiche affiche une image pleine largeur, deux images côte à côte, ou un carrousel au-delà de deux.
- **Aucune capture dans les cartes ni dans le hero** : le Store reste textuel ; la fiche porte les aperçus.
- Les données des captures sont neutres : pas de nom de personne, pas de sujet de recherche personnel.

## Conséquences

- Les captures vivent dans `src/extensions/<id>/media/` et sont référencées par le manifeste.
- Les paquets importés peuvent fournir leurs captures via `screenshots`.
- Une nouvelle capture doit être régénérée depuis le code réel quand l’interface change.
- Les images sont des contenus, pas des décors : pas de dégradé ni de filigrane.

Voir [le Store](../extensions/store.md) et [le format du paquet](../extensions/package.md).
