# 0006 — Aperçu multi-format

## Statut

Accepté.

## Contexte

L’Aperçu était une tuile PDF : une source par tuile, uniquement un lien `https`, téléchargé dans `$APPCACHE/pdf` puis rendu avec pdf.js. L’Explorateur ne savait ouvrir que le Markdown, alors que sa fiche annonçait déjà les PDF. Les autres formats courants (images, audio, vidéo, texte, HTML) n’avaient aucun visualiseur.

## Décision

- Une seule tuile `preview.file` porte tous les formats. Chaque tuile garde **une source** ; plusieurs tuiles Aperçu peuvent coexister, et une nouvelle ouverture crée une tuile.
- L’état vide est le point d’entrée : mosaïque des familles (PDF, image, audio, vidéo, texte, HTML), champ de lien `https`, bouton de fichier et dépôt direct. Les cartes filtrent le sélecteur natif.
- Formats : PDF via pdf.js, images, audio, vidéo, texte et code source, HTML en source. Markdown reste dans l’éditeur `spark.markdown`.
- Un fichier local est autorisé par grant et ajouté à la portée du protocole `asset` à l’exécution (`asset_protocol_scope().allow_file`), sans copie. La portée n’est pas persistée ; `preview_source` la rétablit au chargement de la tuile.
- Les liens non médias sont téléchargés dans `$APPCACHE/preview` ; l’audio et la vidéo distants sont lus directement, ce qui ajoute `media-src https:` à la CSP.
- HTML n’est jamais exécuté. « Ouvrir dans le navigateur » n’est proposé que pour une URL `https` ; un HTML local affiche son source et une note.
- Le service `preview.pdf@1` est conservé pour OpenAlex ; `preview.open@1` ouvre une source générique et indique les formats pris en charge.
- `openalex.pdf` et `preview.pdf` sont migrés vers `preview.file` avec `kind: "pdf"`.

## Conséquences

- Déposer un fichier sur une tuile occupée remplace sa source. Plusieurs fichiers déposés : le premier supporté est affiché, les autres sont signalés.
- Un HTML local ne peut pas s’ouvrir dans le navigateur de Spark, qui n’accepte que `https`.
- Les fichiers locaux ne sont pas copiés : si un fichier est déplacé, la tuile affiche une erreur explicite et propose d’en choisir un autre.
- La capture du Store doit montrer la mosaïque ou un aperçu réel ; elle ne doit pas être une maquette.
- Les plafonds sont ceux du backend : PDF 30 Mo, image 50 Mo, texte 2 Mo, média 100 Mo ; un texte local est affiché sur 512 Ko.

Voir [les extensions intégrées](../extensions/builtins.md), [le backend](../architecture/backend.md), [Tauri](../operations/tauri.md) et [le modèle de confiance](../security/trust-model.md).
