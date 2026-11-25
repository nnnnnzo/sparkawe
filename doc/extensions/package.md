# Format du paquet

## Deux formes

- **Dossier local** : importé en mode développeur depuis **Store › Sources**. Le dossier est copié.
- **Zip** : téléchargé depuis un dépôt, vérifié par SHA-256, extrait dans un staging.

Dans les deux cas, le contenu doit être à la racine du dossier ou du zip :

```text
extension.json
index.js
style.css          # optionnel
icon.svg           # optionnel, lu comme un masque teinté
media/1.webp       # captures optionnelles
```

## `extension.json`

```json
{
  "schema": 2,
  "id": "demo.hello",
  "name": "Hello",
  "version": "0.1.0",
  "subtitle": "Tuile de démonstration",
  "summary": "Affiche un message dans une tuile.",
  "description": "Description longue optionnelle.",
  "category": "Démonstration",
  "icon": "icon.svg",
  "color": "#769ac8",
  "entry": "index.js",
  "style": "style.css",
  "tileTypes": ["demo.hello.tile"],
  "screenshots": ["media/1.webp"],
  "engine": { "spark": ">=0.1" }
}
```

Contraintes :

- `schema` doit valoir `2`.
- `id` : au moins deux segments, minuscules, chiffres et tirets ; `spark.*` et `official.*` réservés ; 64 caractères max.
- `version` : `x.y.z` numérique.
- `name` : 1 à 80 caractères.
- `entry` : fichier relatif `.js` ou `.mjs` existant.
- `style` : fichier relatif `.css` existant, optionnel.
- `icon` : fichier relatif `.svg` existant, 32 Kio max, optionnel.
- `color` : `#rrggbb` ou `#rgb`, optionnel ; noms CSS et `rgb()` refusés.
- `tileTypes` : 1 à 20 types, chacun préfixé par `<id>.`, unique.
- `screenshots` : 0 à 8 fichiers `.webp`, `.png`, `.jpg` ou `.jpeg` existants.
- `certification` interdit dans un paquet importé.
- `summary` ≤ 400 caractères, `description` ≤ 4 000.
- `category` est une chaîne libre, affichée telle quelle pour un paquet importé. Les intégrées utilisent des identifiants stables (`development`, `data`, etc.).
- `name`, `subtitle`, `summary` et `description` sont **monolingues** dans un paquet importé : l’hôte ne les traduit pas. Une localisation déclarative des paquets pourra être ajoutée plus tard sans casser le schéma actuel.

Le backend refuse les chemins absolus, `..`, les séparateurs `\` et les liens symboliques. `.git` et `node_modules` sont ignorés lors de la copie et de l’extraction.

## Icône et teinte

`icon` et `color` donnent au paquet le même rendu qu’une extension intégrée : carte, hero et fiche du Store, en-tête du rail, et barre d’onglet quand la tuile n’a pas d’icône propre.

- L’icône est un **masque CSS**, jamais du markup interprété : le SVG sert d’alpha et la couleur vient de `currentColor`. Aucun script du fichier ne s’exécute, et l’icône se teinte avec l’extension.
- Conséquence : Spark ne peut pas réappliquer l’épaisseur de trait. Dessiner le SVG en viewBox 24, `fill="none"`, `stroke="currentColor"`, `stroke-width="1.7"`, et le tester à 16 px.
- L’icône est servie par le protocole `asset` ; la CSP et la portée `$APPCONFIG/extensions/**` n’ont pas besoin d’être modifiées.
- Sans `icon`, l’onglet affiche le glyphe générique ; sans `color`, l’icône reste neutre et les cartes retombent sur la teinte bleue du Store.

## Bundle

Le paquet est un **script classique**, pas un module ES :

```js
(function () {
  const extensions = (window.SparkExtensions = window.SparkExtensions || {});

  extensions["demo.hello"] = function (runtime) {
    const React = runtime.React;

    function HelloTile() {
      return React.createElement("div", null, "Hello");
    }

    return {
      activate(api) {
        api.tiles.register({
          type: "demo.hello.tile",
          title: "Hello",
          view: HelloTile,
        });
        api.commands.register({
          id: "demo.hello.open",
          title: "Ouvrir Hello",
          tileType: "demo.hello.tile",
          run: () => api.tabs.openTile("demo.hello.tile"),
        });
      },
    };
  };
})();
```

- L’hôte expose `window.SparkRuntime = { React, jsxRuntime }`.
- Le bundle reçoit le même runtime en argument.
- Le bundle ne doit pas importer React par un module nu : il utilise le runtime de l’hôte.
- Le CSS est chargé depuis `style` ; les captures depuis `screenshots`.
- Le paquet n’a pas d’API Tauri dédiée : il partage la fenêtre principale et ses API globales. Voir [le modèle de confiance](../security/trust-model.md).

## Limites

| Limite | Valeur |
|---|---|
| Manifeste | 256 Kio |
| Fichiers | 400 |
| Taille décompressée | 25 Mio |
| Profondeur | 8 |
| Types de tuiles | 20 |
| Icône | 32 Kio |
| Captures | 8 |
| Zip téléchargé | 30 Mio |
| Index de dépôt | 2 Mio |

## Installation et état

- Cible : `extensions/<id>/<version>-<uuid>/`. Les paquets migrés gardent leur dossier `extensions/<id>/<version>/`.
- Staging : `extensions/.staging/<uuid>`, puis renommage atomique.
- État : `spark.db` avec `version`, `path`, `source` (URL du dépôt, absente pour un import local).
- Chaque installation publie un nouveau dossier ; le précédent n’est pas écrasé. Au prochain démarrage, Spark retire les dossiers de paquets non référencés par SQLite et les extractions interrompues dans `.staging`, sous le verrou du profil.
- Une désinstallation retire d’abord l’entrée en base, puis nettoie `extensions/<id>/`. Un échec de nettoyage est journalisé ; le paquet n’est plus chargé.

## Mise à jour

1. Le dépôt publie une version supérieure.
2. `Vérifier` recharge l’index.
3. `Mettre à jour` télécharge et vérifie le zip.
4. L’extension active est désactivée, la nouvelle version est installée, puis réactivée.
5. Les tuiles et l’état de l’extension sont conservés.

## Captures

- Format 16:9, 1280×720, sombre, données neutres.
- Une ou deux captures par intégrée ; la fiche les affiche en pleine largeur, en deux volets ou en carrousel.
- Les captures ne vont pas dans les cartes ni dans le hero.

Voir [publier une extension](authoring.md) et [le Store](store.md).
