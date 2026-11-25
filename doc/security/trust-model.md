# Modèle de confiance

## Décision

Spark exécute les extensions **dans la fenêtre principale**, sans sandbox ni iframe. Une extension importée est du code de confiance : elle partage les API de la page, l’accès au registre, aux services, aux tuiles et aux commandes autorisées pour cette fenêtre.

Ce choix privilégie l’intégration et la simplicité. Il déplace la sécurité vers :

1. le consentement de la personne ;
2. la validation du paquet ;
3. l’intégrité du téléchargement ;
4. l’isolation de panne ;
5. la modération du catalogue, quand elle existera.

## Niveaux

| Niveau | Exemple | Confiance |
|---|---|---|
| Intégrée (`core`) | Terminal, Markdown, Données | Livrée avec Spark, relue avec le binaire. |
| Officielle (`official`) | OpenAlex | Intégration nommée, livrée avec Spark. |
| Communautaire (`community`) | Paquet importé/téléchargé | Confiance explicite de la personne. |

Le champ `certification: "spark"` est prévu pour les paquets publiés et signés par Spark. **Aujourd’hui, le sceau des intégrées est déclaratif : aucune vérification cryptographique n’est branchée.** Une organisation tierce certifiée n’est pas encore supportée.

## Garde-fous actuels

### Avant l’installation

- manifeste v2 validé côté Rust ;
- identifiants `spark.*` et `official.*` réservés ;
- version `x.y.z` ;
- chemins relatifs uniquement, `..` et `\` refusés ;
- liens symboliques refusés ;
- `.git` et `node_modules` ignorés ;
- limites de taille, de fichiers et de profondeur ;
- `certification` refusé dans un paquet importé ;
- HTTPS exigé en release, localhost toléré en debug ;
- SHA-256 vérifié pour un zip ;
- écriture atomique : staging puis renommage.

### Après l’installation

- activation limitée à 5 secondes ;
- erreur d’activation nettoyée, pas de contribution partielle ;
- barrière d’erreur par tuile avec « Réessayer » et « Désactiver l’extension » ;
- désinstallation avec confirmation ;
- import local réservé au mode développeur ;
- sources limitées et URL validées.

### Affichage

- Le Store ne doit pas présenter une extension communautaire comme sûre.
- Le sceau « Certifiée Spark » reste réservé aux paquets qui seront effectivement vérifiés.
- Le bouton d’import développeur ne remplace pas un consentement de distribution publique : ce dernier reste à concevoir pour un Store grand public.

## Ce que les garde-fous ne font pas

- Ils ne sandboxent pas le code.
- Ils n’empêchent pas une extension d’appeler les API Tauri autorisées pour la fenêtre.
- Ils n’isolent pas les services et événements par extension : les identifiants sont globaux.
- Ils ne limitent pas le réseau d’une extension.
- Ils ne vérifient pas encore les signatures.
- Ils ne mettent pas à jour automatiquement.
- Ils ne remplacent pas une revue de code pour un paquet certifié.

## Surface native

Toutes les commandes autorisées à la fenêtre `main` sont accessibles au code exécuté dans cette fenêtre. Les capabilities sont dans `src-tauri/capabilities/` et le CSP/asset dans `tauri.conf.json`. Le protocole `asset` est limité au cache de l’Aperçu et à `$APPCONFIG/extensions/**`.

Un fichier local n’est jamais copié pour l’Aperçu. `preview_select`, `preview_drop` et `preview_from_explorer` vérifient qu’il s’agit d’un fichier ordinaire, refusent les liens symboliques, enregistrent une autorisation de type `preview` dans `spark.db` et l’ajoutent pour la session à la portée du protocole `asset`. La portée n’est pas persistée ; `preview_source` la rétablit depuis un token d’Aperçu connu après revalidation du fichier. Un chemin arbitraire n’est jamais accepté par la tuile.

L’Aperçu ne rend jamais de HTML actif : le source est affiché, et le navigateur natif n’ouvre qu’une URL `https` à la demande. Les médias distants sont lus directement par le webview, qui contacte alors l’hôte ; les autres liens sont téléchargés dans le cache. La tuile n’écrit aucun fichier et la surface ne transporte que le type, le titre et des métadonnées (pages, dimensions, durée), jamais le contenu.

`spark.db` conserve les **30 dernières étapes d’activité par onglet**, avec les instantanés nécessaires pour annuler une action Markdown ou Données. Ce contenu reste local, dans le dossier de configuration, en `0600` sur Unix, avec `secure_delete` ; il s’efface depuis la timeline et n’est jamais exposé par MCP. Il n’est pas chiffré au repos. Un paquet importé s’exécute dans la même fenêtre et peut appeler les commandes `activity_*` autorisées : c’est une conséquence du modèle sans sandbox, pas une nouvelle frontière.

Un navigateur externe n’est pas utilisé pour les extensions : le bundle est injecté dans la page principale, avec React fourni par `window.SparkRuntime`.

La tuile navigateur est la seule exception, et elle va dans l’autre sens : la page distante vit dans une **vue native séparée**, sans IPC Tauri, sans capability `remote`, sans accès au protocole `asset`. Ce n’est pas une sandbox pour les extensions — celles-ci restent dans la page principale — mais une frontière entre le contenu du web et les commandes de Spark. Une page web ne peut donc pas appeler le registre, lire le workspace ou piloter une autre extension.

## Règle de communication

Quand une fonctionnalité touche la confiance :

- dire ce qui est vérifié et ce qui ne l’est pas ;
- ne jamais écrire « sécurisée » ou « sûre » à la place de « signée » ou « vérifiée localement » ;
- distinguer une intégrée d’un paquet communautaire ;
- documenter une limite plutôt que la masquer.

Voir [les décisions](../decisions/0001-trust-model.md) et [les dépôts](../extensions/registry.md).
