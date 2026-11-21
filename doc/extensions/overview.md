# Modèle et cycle de vie des extensions

## Définition

Une extension fournit :

- un **manifeste** : identité, version, niveau, type de tuiles, métadonnées du Store ;
- un **module d’activation** : `activate(api)` enregistre des tuiles et commandes ;
- éventuellement des **services**, événements, styles, captures et guides.

Les contributions sont toutes rattachées à un manifeste propriétaire. Le registre refuse un identifiant de tuile, de commande, de service ou d’action déjà pris.

## Niveaux

| Niveau | Sens | Exécution |
|---|---|---|
| `core` | Socle livré et maintenu avec Spark. | Module React intégré au binaire. |
| `official` | Intégration à un service nommé. | Module React intégré. |
| `community` | Paquet tiers importé ou téléchargé. | Bundle externe chargé dans la fenêtre. |

Le champ `certification: "spark"` décrit un paquet publié et signé par Spark. Aujourd’hui il sert à afficher le sceau des intégrées ; **la vérification cryptographique n’est pas encore branchée**. Voir [le modèle de confiance](../security/trust-model.md).

## Catalogue

Le catalogue initial est construit au démarrage :

- intégrées : `import.meta.glob` sur `src/extensions/*/manifest.ts` et `index.tsx` ;
- importées : `extension_list` lit `extensions.json` et les dossiers `extensions/<id>/<version>/`.

Chaque entrée contient un `Manifest` et un `load()` qui renvoie un `SparkExtension`. Le catalogue est mutable : une installation ajoute une entrée, une désinstallation la retire.

## Cycle de vie

```text
découverte → load() → registry.activate() → activate(api)
                                      │
                                      ├─ tuiles
                                      ├─ actions
                                      ├─ commandes
                                      ├─ services
                                      └─ événements
                                      │
                               deactivate()
                                      │
                               cleanup des contributions
```

- L’activation est limitée à **5 secondes** ; au-delà, elle est interrompue et nettoyée.
- Une erreur d’activation est signalée et ne laisse pas de contribution partielle.
- Une erreur de rendu dans une tuile est contenue par une barrière d’erreur : « Réessayer » ou « Désactiver l’extension ».
- La désactivation conserve les tuiles et leur `data` ; la vue devient indisponible.

## États visibles

- **Active** : extension chargée, contributions présentes.
- **Inactive** : paquet présent sur disque mais retiré de `installedExtensions` ; tuiles et snapshot d’état conservés.
- **Non installée** : paquet connu dans un dépôt mais absent localement.
- **En échec** : chargement ou rendu en erreur ; l’interface propose de réessayer ou de désactiver.

## Import et mise à jour

- Un paquet local peut être importé depuis un dossier en mode développeur.
- Un paquet zip peut être téléchargé depuis un dépôt, vérifié par SHA-256 et installé.
- Une mise à jour remplace la version active : désactivation, chargement du nouveau bundle, réactivation, état conservé.
- Une désinstallation retire le paquet et l’id installé ; les tuiles restent dans le workspace et deviennent indisponibles.

Voir [le paquet](package.md), [le Store](store.md), [les dépôts](registry.md).

## Extensions intégrées

Voir [la liste détaillée](builtins.md) : Terminal, Markdown, Données, Explorateur, Aperçu, OpenAlex.

## Contrats de coopération

Les services et événements vivent dans l’espace global du registre. Ils ne sont pas isolés par extension. Une extension doit préfixer ses identifiants et vérifier la présence d’un service avant de l’utiliser.

Voir [le SDK](sdk.md).
