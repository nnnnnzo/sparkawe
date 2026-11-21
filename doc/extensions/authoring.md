# Publier une extension

Il n’y a pas encore de CLI ni de template officiel. Un paquet se construit et se publie à la main ; `examples/hello-extension` sert de référence minimale et `examples/sparklab-day` de paquet complet, avec deux tuiles, des actions et un fichier d’état.

## 1. Créer le dossier

```text
mon-extension/
  extension.json
  index.js
  style.css
  icon.svg            # optionnel
  media/1.webp        # optionnel
```

`extension.json` doit respecter [le schéma v2](package.md). L’identifiant doit être stable et préfixé par l’éditeur, par exemple `acme.timeline`. `spark.*` et `official.*` sont réservés.

## 2. Écrire le bundle

Le bundle est un script classique :

```js
(function () {
  const extensions = (window.SparkExtensions = window.SparkExtensions || {});

  extensions["acme.timeline"] = function (runtime) {
    const React = runtime.React;

    function Timeline() {
      return React.createElement("div", { className: "timeline" }, "Timeline");
    }

    return {
      activate(api) {
        api.tiles.register({
          type: "acme.timeline.tile",
          title: "Timeline",
          view: Timeline,
          guide: "Timeline en lecture seule. Aucune action.",
        });
        api.commands.register({
          id: "acme.timeline.open",
          title: "Ouvrir Timeline",
          tileType: "acme.timeline.tile",
          run: () => api.tabs.openTile("acme.timeline.tile"),
        });
      },
    };
  };
})();
```

Règles :

- pas d’import React nu : React vient de `window.SparkRuntime` ;
- le bundle doit s’enregistrer sous l’identifiant exact du manifeste ;
- le script est classique ; un bundle IIFE/UMD est attendu ;
- les styles restent dans le CSS du paquet ;
- les actions renvoient des identifiants/résumés, jamais un document entier.

Pour un projet TypeScript/React, un build Vite en mode librairie avec React externalisé et un wrapper IIFE fonctionne. Le contrat qui compte est le script final, pas la chaîne de build.

## 3. Icône et teinte

Deux champs optionnels suffisent pour que le paquet ressemble à une intégrée partout : carte, hero et fiche du Store, rail, barre d’onglet.

```json
{ "icon": "icon.svg", "color": "#769ac8" }
```

- Le SVG est lu comme un **masque** : seul son alpha compte. Dessiner en viewBox 24, `fill="none"`, `stroke="currentColor"`, `stroke-width="1.7"`, puis vérifier le rendu à 16 px. Spark ne réapplique pas l’épaisseur de trait.
- `color` est une teinte du spectre ou une couleur assortie, en `#rrggbb` ou `#rgb`. Noms CSS et `rgb()` sont refusés à l’installation.
- 32 Kio maximum. Un fichier absent ou trop lourd fait échouer l’import avec un message explicite.

## 4. Captures

- 1280×720 (16:9), thème sombre, données neutres.
- 1 ou 2 captures par extension.
- Pas de données personnelles, pas de captures dans les cartes du Store.
- Les captures d’un paquet importé sont résolues depuis son manifeste.

## 5. Packager

Le zip doit contenir les fichiers **à la racine**, pas un dossier parent :

```text
extension.json
index.js
style.css
media/1.webp
```

Calculer l’empreinte :

```bash
shasum -a 256 mon-extension-1.0.0.zip
```

## 6. Publier un index

Un dépôt est un JSON statique :

```json
{
  "schema": 1,
  "name": "Mon dépôt",
  "extensions": [{
    "id": "acme.timeline",
    "name": "Timeline",
    "publisher": "Acme",
    "summary": "Une frise chronologique.",
    "category": "Notes",
    "versions": [{
      "version": "1.0.0",
      "url": "https://…/mon-extension-1.0.0.zip",
      "sha256": "…",
      "size": 12345
    }]
  }]
}
```

Héberger l’index et les zips en HTTPS. En développement, `http://127.0.0.1` est accepté.

## 7. Tester

Option locale, sans dépôt :

1. activer le mode développeur ;
2. **Store › Sources** ;
3. **Parcourir** ou coller le dossier ;
4. **Installer**.

Le paquet est copié dans la configuration de Spark : modifier les sources ne change rien tant que l’extension n’est pas réinstallée. Réinstaller depuis le même dossier suffit — Spark désactive, remplace, réactive, et le bundle et les styles sont rechargés sans redémarrer l’application. Augmenter `version` n’est utile qu’à la publication. L’état de l’extension et les tuiles ouvertes sont conservés.

Option dépôt :

1. servir l’index et le zip (Vite, GitHub Pages, release GitHub) ;
2. ajouter l’URL de l’index dans **Sources** ;
3. le Store ouvre la galerie du dépôt ;
4. installer l’extension, ouvrir sa fiche, vérifier la galerie et la tuile.

`examples/registry.json` et les zips `examples/hello-extension*.zip` forment un dépôt de test local.

## 8. Mettre à jour

- Incrémenter `version` dans `extension.json` et dans le nom du zip.
- Recalculer le SHA-256.
- Ajouter la version dans l’index (la plus haute est retenue).
- L’utilisateur voit la mise à jour dans **Mises à jour** et l’installe manuellement.
- Aucune signature n’est vérifiée aujourd’hui ; ne pas se présenter comme certifié Spark.

## Checklist

- [ ] identifiant stable, non réservé ;
- [ ] `schema: 2`, version `x.y.z` ;
- [ ] `entry` et `style` existent ;
- [ ] `icon` en SVG, viewBox 24, trait 1.7, 32 Kio max ; `color` en hexadécimal ;
- [ ] types de tuiles préfixés et uniques ;
- [ ] bundle enregistré dans `window.SparkExtensions[id]` ;
- [ ] React via `window.SparkRuntime` ;
- [ ] captures 16:9, neutres ;
- [ ] zip à plat, SHA-256 recalculé ;
- [ ] index valide et accessible en HTTPS ;
- [ ] testé via le Store, y compris activation, désactivation et mise à jour.
