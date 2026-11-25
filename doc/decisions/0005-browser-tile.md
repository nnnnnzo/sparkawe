# 0005 — Navigateur dans une tuile native

## Statut

Accepté.

## Contexte

Spark doit ouvrir des pages web complètes dans l’espace de travail. Une tuile est hébergée dans un groupe Dockview ; deux voies étaient possibles pour afficher une page :

- un `iframe` : il bute sur `X-Frame-Options` et `frame-ancestors`, n’ouvre pas la session, et demanderait d’ouvrir `frame-src` dans la CSP ;
- une vue web native enfant de la fenêtre principale (multi-vue de Tauri), posée sur le rectangle mesuré par la tuile.

## Décision

- La page est rendue par **une vue native enfant** de la fenêtre `main` (`Window::add_child`), jamais par un `iframe`.
- La multi-vue de Tauri reste derrière la feature Cargo `unstable` : la version de Tauri est donc épinglée par `Cargo.lock` et à revoir à chaque montée de version.
- La tuile ne rend que la barre et un **rectangle mesuré** ; le contenu de la page n’entre jamais dans le DOM de Spark.
- `web_open` crée la vue si elle manque et la replace sinon : elle **ne navigue jamais**. Toute navigation est explicite (`web_navigate`, barre d’adresse, action), sinon déplacer une tuile rejouerait la page et perdrait son état.
- Lors d’un changement structurel animé, chaque groupe dont la géométrie change suit l’animation FLIP (translation, largeur, hauteur). Le séparateur redimensionne les groupes directement, sans cette animation.
- Une vue native ne suit pas un `transform` : elle se masque pendant le déplacement animé d’un groupe (`src/ui/layoutSignal.ts`), puis revient en fondu à son rectangle final. Au séparateur, elle suit le rectangle mesuré.
- Les coins bas de la vue sont arrondis à 8 px par son calque natif, comme le groupe ; la barre d’onglets couvre le haut.
- L’apparence est imposée à chaque vue web (`web_appearance` → `NSAppearance` de la vue) : les pages reçoivent `prefers-color-scheme` selon le thème de Spark, indépendamment du réglage du système.
- Une page apparaît en fondu de 160 ms et s’efface en 140 ms ; le masquage n’intervient qu’après le fondu, sinon une vue transparente recevrait encore les clics.
- Un média ne démarre pas tout seul dans une page ouverte ou restaurée : il faut un geste réel dans la page. Wry ouvre le webview avec l’autoplay natif autorisé et `navigator.userActivation` est déjà actif à l’ouverture sur WebKit : le garde-fou compte donc ses propres gestes, par document, neutralise l’attribut `autoplay`, et rabat les évènements `play`, `playing` et `timeupdate`.
- Une tuile qui ouvre une page demande une **place en onglet dans le groupe** de la tuile d’origine (`src/ui/layoutPlacement.ts`, `direction: "within"`). La demande est volatile, hors persistance.
- Un lien qui demande une nouvelle fenêtre, un `window.open` ou un **clic molette sur un lien** passent par `on_new_window` (`Deny` côté natif) et ouvrent cette tuile.
- Une vue native passe au-dessus du DOM : toute couche flottante qui la chevauche (Store, menu DOM, dialogue) la masque le temps qu’elle est ouverte. Pendant un glisser-déposer, la page elle-même est remplacée par une image (`web_snapshot`) : elle reste visible et la vignette d’onglet comme la cible de dépôt passent au-dessus. Le menu de déplacement d’une tuile est donc un **menu du système** (`popup_tile_menu`), qui s’affiche au-dessus sans rien masquer.
- Six vues natives au maximum ; la moins récemment affichée est fermée quand la limite est dépassée. Une tuile suspendue se rouvre à son adresse quand elle redevient visible.
- La vue native **n’a aucun IPC Tauri** : aucun `remote` dans les capabilities. Seules les adresses `https` sont acceptées (`http` en debug), et `file:`, `asset:`, `ipc:` et `javascript:` sont refusés.
- Les téléchargements sont refusés avec un message ; les permissions média, géolocalisation et notifications ne sont pas accordées.
- Sous Linux, le positionnement des vues enfants est encore cassé en amont (tauri#10420). La tuile reste indisponible avec un message explicite jusqu’au correctif, qui est d’abord proposé en amont.

## Conséquences

- Une tuile navigateur ne peut pas être capturée depuis React : ses captures de Store montrent **l’habillage** (barre et état vide), jamais une fausse page. C’est un écart assumé par rapport à la [décision 0003](0003-extension-captures.md).
- Le profil du webview vit dans `$APPCACHE/web/profile/` sous Windows et Linux ; sous macOS, WKWebView utilise le magasin de données WebKit de l’application (`~/Library/WebKit/fr.spark.desktop/`). Le texte extrait pour un agent est écrit dans `$APPCACHE/web/text/<tuile>.txt`.
- La session (cookies, connexions) persiste entre les lancements, comme un navigateur.
- Un changement de version de Tauri demande de revérifier le positionnement, le focus et le redimensionnement des vues enfants sur les trois plateformes.
- Redimensionner, glisser, changer d’onglet ou annuler une disposition réémet la boîte de la vue : le coût est une mesure de rectangle par image pendant le geste.

Voir [les extensions intégrées](../extensions/builtins.md), [l’espace de travail](../architecture/workspace.md) et [le modèle de confiance](../security/trust-model.md).
