# Dépôts et mises à jour

## Source

Un dépôt est une URL HTTPS vers un index JSON statique. Il peut être ajouté dans **Store › Sources**, avec un nom facultatif (sinon l’hôte de l’URL est utilisé).

- Maximum 20 dépôts.
- Les sources sont persistées dans `extensions.json`, avec les paquets installés.
- En release, seules les URL HTTPS sont acceptées ; en debug, `http://127.0.0.1` et `http://localhost` sont tolérés pour les tests locaux.
- Aucun index n’est mis en cache sur disque : `Vérifier` recharge, un redémarrage redemande les index.

## Index

```json
{
  "schema": 1,
  "name": "Mon dépôt",
  "updatedAt": "2026-11-21T22:00:00Z",
  "extensions": [{
    "id": "demo.hello",
    "name": "Hello",
    "publisher": "Demo",
    "subtitle": "Tuile de démonstration",
    "summary": "Une ligne de description.",
    "description": "Description longue optionnelle.",
    "category": "Démonstration",
    "repository": "https://…",
    "versions": [{
      "version": "0.3.0",
      "url": "https://…/hello-0.3.0.zip",
      "sha256": "…",
      "size": 1307,
      "engine": ">=0.1",
      "publishedAt": "2026-11-21T22:00:00Z"
    }]
  }]
}
```

- Le front normalise et ignore les entrées sans `id`, `name` ou versions valides.
- La dernière version est choisie par comparaison numérique `x.y.z`.
- Une version doit fournir `version`, `url` et `sha256`.
- Le backend vérifie seulement `schema: 1` et la présence d’un tableau `extensions`.

## Découverte

- La page **Sources** liste les dépôts.
- Cliquer un dépôt ouvre une **galerie de dépôt** : une carte par extension distante, avec version, éditeur, résumé et action.
- Le nombre d’extensions est affiché sur la carte du dépôt.
- Après l’ajout d’un dépôt, le Store ouvre directement sa galerie. Les extensions sont visibles sans installation.
- Une erreur d’index est affichée sous la carte et dans la galerie.
- La galerie n’est pas la page Découvrir : elle montre le contenu du dépôt sélectionné.

## Installation

```text
registry_fetch(url)
  → download zip (30 Mio max)
  → SHA-256 attendu
  → extraction contrôlée
  → extension.json validé
  → staging → extensions/<id>/<version>/
  → extensions.json (version, chemin, source)
  → ExtensionManager.addEntry
  → activation
```

- Si le paquet était déjà actif, il est désactivé puis rechargé.
- Le dossier de l’ancienne version n’est pas supprimé ; l’état pointe la version courante.
- Une erreur de téléchargement, d’empreinte, d’extraction ou de manifeste laisse l’installation précédente intacte.
- Le bouton devient **Réinstaller** si le paquet est présent, **Mettre à jour** si une version supérieure est publiée.

## Mises à jour

- `Marketplace.updates(installed)` compare les versions des extensions communautaires présentes dans `installedExtensions` avec la dernière version de chaque dépôt.
- Une mise à jour est une installation zip de la nouvelle version ; elle suit le même chemin.
- Aucune installation automatique : l’utilisateur clique **Vérifier** puis **Mettre à jour**.
- Les intégrées ne sont pas mises à jour par un dépôt.

## Sécurité

- SHA-256 vérifié avant extraction ; HTTPS exigé en release.
- Chemins relatifs, `..`, liens symboliques, `.git` et `node_modules` refusés/ignorés.
- Limites : 2 Mio d’index, 30 Mio de zip, 400 fichiers, 25 Mio décompressés, 20 types de tuiles, 8 captures.
- Aucune signature n’est vérifiée aujourd’hui. Une extension communautaire est du code de confiance ; voir [le modèle de confiance](../security/trust-model.md).
- Le champ `certification` d’un paquet importé est refusé : un paquet ne peut pas se déclarer certifié.

## Dépôt de démonstration

`examples/registry.json` pointe vers les zips 0.1.0, 0.2.0 et 0.3.0 de `examples/hello-extension*`. Les URL utilisent `http://127.0.0.1:1420`, donc le serveur Vite doit tourner. Ajouter :

```text
http://127.0.0.1:1420/examples/registry.json
```

Le dépôt s’ouvre directement sur la galerie Hello ; la version 0.3.0 est la plus récente.

## Évolution

- Signature Spark/org : à brancher avant de qualifier un paquet de certifié.
- Cache disque des index, canaux stable/beta, révocation et rollback : non implémentés.
- Publication : voir [publier une extension](authoring.md).
