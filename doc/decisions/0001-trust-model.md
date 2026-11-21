# 0001 — Modèle de confiance des extensions

## Statut

Accepté.

## Contexte

Spark doit pouvoir recevoir des extensions tierces sans reconstruire chaque fois le binaire. Une première piste était un sandbox iframe avec un bridge `postMessage`. Elle imposait un second runtime, des problèmes de focus, de thème, de drag & drop et une surface d’API plus pauvre.

## Décision

- Les extensions s’exécutent **dans la fenêtre principale**, sans sandbox.
- Une extension communautaire est installée avec un **consentement de confiance** : elle partage les accès de Spark.
- La signature est réservée, à terme, aux paquets **certifiés Spark** et aux organisations officielles.
- Pas d’iframe, pas de bridge, pas d’enforcement de permissions dans cette version.
- La sécurité repose sur la validation du paquet, l’intégrité SHA-256, l’activation bornée, la barrière d’erreur et la désinstallation.

## Conséquences

- Un paquet malveillant peut agir avec les accès de l’application. Ce risque est assumé et documenté.
- Le Store ne doit pas qualifier une extension communautaire de « sûre ».
- Une extension certifiée devra être signée et vérifiée avant d’afficher le sceau.
- Les services et événements restent globaux ; les identifiants doivent être préfixés.
- Le protocole `asset` et le CSP sont ouverts aux paquets importés.

Voir [le modèle de confiance](../security/trust-model.md).
