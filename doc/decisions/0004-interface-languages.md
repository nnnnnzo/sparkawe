# 0004 — Langues de l’interface

## Contexte

L’interface était entièrement en français, y compris le Store et les six extensions intégrées. Les réglages ne contenaient que `dev`. Les paquets importés peuvent contenir du texte dans n’importe quelle langue, et le pont MCP sert des agents qui ne parlent pas forcément français.

## Décision

- Huit langues : `fr`, `en`, `es`, `de`, `it`, `pt`, `ja`, `zh`.
- Dictionnaires TypeScript internes, sans dépendance i18n : une clé porte les huit traductions dans le même objet.
- `LocalizedText = string | { key }` dans le SDK : les paquets importés gardent des chaînes, les intégrées référencent le dictionnaire de l’hôte.
- Le réglage (`locale`) vit dans les préférences de l’application, pas dans le workspace. Le snapshot `settings` dans `spark.db` remplace le fichier d’origine `settings-v1.json`.
- Sélecteur dans **Paramètres → Langue**, avec nom natif et emoji drapeau. Choix motivé par le rendu macOS ; le nom natif reste lisible si l’emoji n’est pas rendu.
- Repli sur l’anglais quand la langue du système n’est pas prise en charge ; une langue enregistrée gagne toujours.
- Changement à chaud, sans redémarrage. Les effets qui possèdent une ressource (PTY, CodeMirror, PDF) ne dépendent jamais de la locale.

## Conséquences

- Le Store affiche des catégories stables (`data`, `development`, etc.) traduites à l’affichage ; les filtres ne dépendent pas de la langue.
- Les métadonnées d’un paquet importé restent dans leur langue d’origine. Le format `extension.json` n’ajoute aucun champ multilingue.
- Les textes destinés aux agents (brief, guides, titres d’actions) suivent la langue de l’interface. Les descriptions d’outils MCP et les erreurs natives Rust restent à traduire dans une passe ultérieure.
- Ajouter une langue demande de remplir chaque clé dans chaque fichier de domaine ; le compilateur guide le travail.
