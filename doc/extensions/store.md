# Store

Le Store est une **page**, pas un dialog. Il est monté en overlay au-dessus du workspace ; le workspace reste monté et les sessions terminal survivent.

## Structure

- Sidebar flottante : Découvrir, Mises à jour, Installées, Sources, Retour à l’espace.
- Contenu pleine largeur.
- Sidebar réduite à 56 px sous 860 px.
- `Échap` : retour à la vue d’origine depuis une fiche, sinon accueil puis fermeture.
- Cliquer un onglet ferme le Store et active l’onglet.

## Découvrir

- Hero « À la une » avec texte et tuile d’icône, sans capture.
- Étagères horizontales « Intégrées » et « Officielles ».
- Section « Communautaires » : les paquets connus localement ouvrent leur fiche, et les extensions d’un dépôt non installées apparaissent avec un bouton **Installer**. Ajouter un dépôt remplit donc cette section même sans installation.
- Chips de catégories et recherche sans accents.
- Cartes textuelles : icône, nom, sceau éventuel, sous-titre factuel, catégorie. **Aucune capture dans les cartes.**
- Toute la carte ouvre la fiche ; une carte distante non installée porte directement l’action d’installation.
- Les cartes d’étagère prennent une fraction entière de la largeur : 4 au-dessus de 1 600 px, 3 de 1 200 à 1 600, 2 de 700 à 1 200, 1 en dessous. Pas de carte coupée ; les flèches défilent d’une page.

## Fiche

- Icône, nom, sceau, sous-titre, éditeur, version, catégorie.
- Actions : Ouvrir, Activer/Désactiver, épingler, désinstaller pour une extension communautaire.
- Galerie : capture unique, deux captures côte à côte, ou carrousel au-delà de deux. Les images sont en 16:9.
- « À propos », « Informations » (éditeur, version, catégorie, type, état, identifiant, tuiles).
- Le bouton retour reprend la vue qui a ouvert la fiche (Découvrir, Installées, Sources) et la sidebar met cette vue en avant.
- Désinstallation : dialog de confirmation ; le paquet et l’entrée d’installation sont retirés, les tuiles ouvertes deviennent indisponibles. Le snapshot d’état de l’extension reste dans le workspace.

## Installées

- Lignes compactes, état actif/inactif, épinglage, activer/désactiver, détails.
- La liste et le compteur correspondent à `installedExtensions` : les extensions activées. Désactiver retire donc l’extension de cette liste et du compteur ; le paquet et le snapshot d’état restent sur disque, et les tuiles restent dans le workspace.
- Une extension présente sur disque mais retirée de `installedExtensions` réapparaît dans **Communautaires** avec une action d’activation/réinstallation.
- Le snapshot d’état n’est pas supprimé par une désinstallation ; il reste dans `workspace.extensions` tant que le workspace le conserve.

## Mises à jour

- Construites à partir des index de dépôts et des versions installées communautaires.
- Affiche `version actuelle → version disponible`, la source et un bouton **Mettre à jour**.
- `Vérifier` recharge les sources et les index.
- Aucune mise à jour automatique.

## Sources

- Carte **Catalogue Spark** : le socle intégré, non supprimable.
- Import développeur : dossier local, avec bouton **Parcourir** (sélecteur natif) et chemin éditable.
- Dépôts : formulaire d’ajout (nom optionnel + URL), puis liste des dépôts.
- Chaque dépôt est une carte cliquable : nom, URL, nombre d’extensions, chevron, bouton de retrait.
- Cliquer un dépôt ouvre une **galerie de dépôt** : les extensions distantes en cartes, avec version, éditeur, résumé et bouton Installer/Mettre à jour/Réinstaller.
- Après l’ajout d’un dépôt, le Store ouvre directement sa galerie : les extensions sont visibles sans devoir installer quoi que ce soit.
- Une erreur de chargement d’un index est affichée sous sa carte et dans la galerie.
- Retirer un dépôt supprime ses entrées et son erreur.

## Captures

- Les captures vivent uniquement dans la galerie de la fiche.
- Pas de capture dans les cartes, pas de capture dans le hero.
- Sources des intégrées : `src/extensions/<id>/media/*.webp`.
- 1280×720, thème sombre, données neutres.
- Markdown, Données et OpenAlex ont deux captures ; les autres une.
- Les captures d’un paquet importé sont résolues depuis son manifeste via le protocole `asset`.

## Interaction et accessibilité

- Tous les éléments cliquables ont `cursor: pointer` ; les flèches désactivées gardent le curseur normal.
- Cartes = boutons ; les actions secondaires sont des boutons séparés.
- Tooltip du sceau au survol et au focus.
- Focus rendu au bouton Extensions à la fermeture.
- Le workspace est `inert` et `aria-hidden` quand le Store est ouvert.

Voir [les dépôts](registry.md), [le format du paquet](package.md) et [les décisions](../decisions/0002-store-navigation.md).
