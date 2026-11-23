//! Navigateur web : une vue native par tuile.
//!
//! Les tuiles Spark sont du DOM. Une page web complète ne peut pas vivre dans
//! un cadre : la plupart des sites refusent d’être encadrés et la CSP de Spark
//! ferme `frame-src`. On attache donc une vue native enfant à la fenêtre
//! principale, posée sur le rectangle mesuré par la tuile.
//!
//! Ce chemin dépend de la multi-vue de Tauri, derrière la feature `unstable`.
//! Sous Linux, le positionnement des vues enfants est encore cassé en amont
//! (tauri#10420) : la tuile reste indisponible avec un message explicite.

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::Duration,
};

use tauri::{
    webview::{DownloadEvent, NewWindowResponse, PageLoadEvent, PageLoadPayload},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, State, Url, Webview, WebviewUrl,
};

/// État poussé au front ; chaque champ absent est laissé tel quel côté tuile.
const STATE_EVENT: &str = "web-state";
/// Une page demande une nouvelle fenêtre : le front ouvre une tuile.
const POPUP_EVENT: &str = "web-popup";
const MAX_TEXT: usize = 6_000;
const TEXT_TIMEOUT: Duration = Duration::from_secs(10);

/// Vues web ouvertes, et préférence de schéma couleur des pages.
pub struct Pages {
    views: Mutex<HashMap<String, Webview>>,
    dark: AtomicBool,
    /// Dernière demande d’affichage par tuile : un fondu de sortie ne doit pas
    /// cacher une vue que quelqu’un vient de redemander.
    generation: Mutex<HashMap<String, u64>>,
    counter: std::sync::atomic::AtomicU64,
}

impl Default for Pages {
    fn default() -> Self {
        Self {
            views: Mutex::new(HashMap::new()),
            dark: AtomicBool::new(true),
            generation: Mutex::new(HashMap::new()),
            counter: std::sync::atomic::AtomicU64::new(0),
        }
    }
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WebState {
    tile: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    loading: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    notice: Option<String>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Popup {
    tile: String,
    url: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageText {
    url: String,
    title: String,
    path: String,
    bytes: usize,
    characters: usize,
    text: String,
    truncated: bool,
}

#[tauri::command]
pub async fn web_open(
    app: AppHandle,
    pages: State<'_, Pages>,
    tile: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<bool, String> {
    if !platform_ready() {
        return Err(unavailable());
    }
    let id = tile_id(&tile)?;
    let target = sanitize(&url)?;
    let existing = pages
        .views
        .lock()
        .map_err(crate::storage::message)?
        .get(&id)
        .cloned();
    if let Some(view) = existing {
        // La vue existe : on la replace, on ne la recharge jamais. Une
        // navigation est un geste explicite (`web_navigate`), sinon un
        // déplacement de tuile rejouerait la page et perdrait son état.
        view.set_bounds(rect(x, y, width, height))
            .map_err(crate::storage::message)?;
        // Un masquage différé peut encore être en vol : le remontrer doit
        // l’invalider, sinon la vue se cache juste après être revenue.
        reveal(&pages, &id, &view)?;
        return Ok(false);
    }

    let label = format!("web-{id}");
    let window = app
        .get_window("main")
        .ok_or_else(|| "Fenêtre principale introuvable.".to_string())?;
    let profile = profile_directory(&app)?;
    let view = window
        .add_child(
            build(&app, &id, label, target, profile),
            LogicalPosition::new(x, y),
            LogicalSize::new(width, height),
        )
        .map_err(crate::storage::message)?;
    style_view(&view, pages.dark.load(Ordering::Relaxed));
    pages
        .views
        .lock()
        .map_err(crate::storage::message)?
        .insert(id.clone(), view);
    emit(
        &app,
        WebState {
            tile: id,
            url: Some(url),
            loading: Some(true),
            title: None,
            notice: None,
        },
    );
    Ok(true)
}

/// Instantané de la page, pour la garder visible pendant un glisser-déposer :
/// une image dans le DOM passe sous les overlays de Dockview, une vue native
/// non.
#[tauri::command]
pub async fn web_snapshot(pages: State<'_, Pages>, tile: String) -> Result<String, String> {
    let view = page(&pages, &tile)?;
    let (sender, receiver) = std::sync::mpsc::channel::<Option<String>>();
    view.with_webview(move |platform| snapshot(platform.inner(), sender))
        .map_err(crate::storage::message)?;
    let image = tauri::async_runtime::spawn_blocking(move || {
        receiver.recv_timeout(Duration::from_secs(4)).ok().flatten()
    })
    .await
    .map_err(crate::storage::message)?;
    Ok(image.unwrap_or_default())
}

#[cfg(target_os = "macos")]
fn snapshot(view: *mut std::ffi::c_void, sender: std::sync::mpsc::Sender<Option<String>>) {
    use base64::Engine;
    use block2::RcBlock;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
    use objc2_foundation::{NSDictionary, NSError};
    use objc2_web_kit::WKWebView;

    let handler = RcBlock::new(move |image: *mut NSImage, _error: *mut NSError| {
        let png = unsafe { image.as_ref() }.and_then(|image| {
            let tiff = image.TIFFRepresentation()?;
            let bitmap = NSBitmapImageRep::imageRepWithData(&tiff)?;
            unsafe {
                bitmap.representationUsingType_properties(
                    NSBitmapImageFileType::PNG,
                    &NSDictionary::new(),
                )
            }
        });
        let encoded = png.map(|data| {
            format!(
                "data:image/png;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(data.to_vec())
            )
        });
        let _ = sender.send(encoded);
    });
    unsafe {
        let webview = &*(view as *const WKWebView);
        webview.takeSnapshotWithConfiguration_completionHandler(None, &handler);
    }
}

#[cfg(not(target_os = "macos"))]
fn snapshot(_view: *mut std::ffi::c_void, sender: std::sync::mpsc::Sender<Option<String>>) {
    let _ = sender.send(None);
}

#[tauri::command]
pub fn web_bounds(
    pages: State<'_, Pages>,
    tile: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let view = page(&pages, &tile)?;
    view.set_bounds(rect(x, y, width, height))
        .map_err(crate::storage::message)
}

#[tauri::command]
pub fn web_show(
    app: AppHandle,
    pages: State<'_, Pages>,
    tile: String,
    visible: bool,
) -> Result<(), String> {
    let view = page(&pages, &tile)?;
    if visible {
        reveal(&pages, &tile, &view)?;
        return Ok(());
    }
    let generation = next_generation(&pages, &tile);
    // On laisse le fondu se terminer avant de cacher : une vue transparente
    // continuerait de recevoir les clics.
    fade_out(&view);
    tauri::async_runtime::spawn_blocking(move || {
        std::thread::sleep(Duration::from_millis(110));
        let pages = app.state::<Pages>();
        if is_current(&pages, &tile, generation) {
            if let Ok(view) = page(&pages, &tile) {
                let _ = view.hide();
            }
        }
    });
    Ok(())
}

/// Le schéma couleur des pages suit le thème de Spark : `prefers-color-scheme`
/// bascule sur la vue elle-même, sans dépendre de l’apparence de l’application.
#[tauri::command]
pub fn web_appearance(pages: State<'_, Pages>, dark: bool) -> Result<(), String> {
    pages.dark.store(dark, Ordering::Relaxed);
    let views: Vec<Webview> = pages
        .views
        .lock()
        .map_err(crate::storage::message)?
        .values()
        .cloned()
        .collect();
    for view in views {
        style_view(&view, dark);
    }
    Ok(())
}

#[tauri::command]
pub fn web_navigate(pages: State<'_, Pages>, tile: String, url: String) -> Result<(), String> {
    let view = page(&pages, &tile)?;
    let target = sanitize(&url)?;
    view.navigate(target).map_err(crate::storage::message)
}

#[tauri::command]
pub fn web_history(pages: State<'_, Pages>, tile: String, move_by: i32) -> Result<(), String> {
    let view = page(&pages, &tile)?;
    view.eval(format!("history.go({move_by});"))
        .map_err(crate::storage::message)
}

#[tauri::command]
pub fn web_reload(pages: State<'_, Pages>, tile: String) -> Result<(), String> {
    let view = page(&pages, &tile)?;
    view.eval("location.reload();")
        .map_err(crate::storage::message)
}

#[tauri::command]
pub fn web_close(pages: State<'_, Pages>, tile: String) -> Result<(), String> {
    let view = pages
        .views
        .lock()
        .map_err(crate::storage::message)?
        .remove(&tile);
    if let Some(view) = view {
        view.close().map_err(crate::storage::message)?;
    }
    Ok(())
}

/// Lit le texte visible de la page. Le retour est borné ; le texte complet part
/// dans un fichier de cache dont l’appel renvoie le chemin.
#[tauri::command]
pub async fn web_read_text(
    app: AppHandle,
    pages: State<'_, Pages>,
    tile: String,
) -> Result<PageText, String> {
    let view = page(&pages, &tile)?;
    let (sender, receiver) = std::sync::mpsc::channel();
    view.eval_with_callback(EXTRACT_SCRIPT, move |value| {
        let _ = sender.send(value);
    })
    .map_err(crate::storage::message)?;
    let raw = tauri::async_runtime::spawn_blocking(move || receiver.recv_timeout(TEXT_TIMEOUT))
        .await
        .map_err(crate::storage::message)?
        .map_err(|_| "La page n’a pas répondu.".to_string())?;
    let page = decode(&raw)?;

    let directory = app
        .path()
        .app_cache_dir()
        .map_err(crate::storage::message)?
        .join("web")
        .join("text");
    std::fs::create_dir_all(&directory).map_err(crate::storage::message)?;
    let path = directory.join(format!("{}.txt", tile_id(&tile)?));
    crate::storage::atomic_write(&path, page.text.as_bytes()).map_err(crate::storage::message)?;

    let characters = page.text.chars().count();
    let text: String = page.text.chars().take(MAX_TEXT).collect();
    Ok(PageText {
        url: page.url,
        title: page.title,
        path: path.to_string_lossy().into_owned(),
        bytes: page.text.len(),
        characters,
        text,
        truncated: characters > MAX_TEXT,
    })
}

/// Habille la vue native : coins bas arrondis comme l’overlay du groupe
/// Dockview (`0 0 8px 8px`) et schéma couleur imposé à la page.
#[cfg(target_os = "macos")]
fn style_view(view: &Webview, dark: bool) {
    use objc2_app_kit::{
        NSAppearance, NSAppearanceCustomization, NSAppearanceNameAqua, NSAppearanceNameDarkAqua,
        NSView,
    };
    use objc2_quartz_core::CACornerMask;

    let _ = view.with_webview(move |platform| {
        let ns_view = unsafe { &*(platform.inner() as *const NSView) };
        let name = unsafe {
            if dark {
                NSAppearanceNameDarkAqua
            } else {
                NSAppearanceNameAqua
            }
        };
        if let Some(appearance) = NSAppearance::appearanceNamed(name) {
            ns_view.setAppearance(Some(&appearance));
        }
        ns_view.setWantsLayer(true);
        let Some(layer) = ns_view.layer() else {
            return;
        };
        layer.setCornerRadius(8.0);
        layer.setMasksToBounds(true);
        layer.setMaskedCorners(if layer.isGeometryFlipped() {
            CACornerMask::LayerMinXMaxYCorner | CACornerMask::LayerMaxXMaxYCorner
        } else {
            CACornerMask::LayerMinXMinYCorner | CACornerMask::LayerMaxXMinYCorner
        });
    });
}

#[cfg(not(target_os = "macos"))]
fn style_view(_view: &Webview, _dark: bool) {}

/// Fait apparaître la page en fondu, pour ne pas la voir surgir d’un coup.
#[cfg(target_os = "macos")]
fn fade_in(view: &Webview) {
    use objc2_app_kit::{NSAnimatablePropertyContainer, NSAnimationContext, NSView};

    let _ = view.with_webview(|platform| {
        let ns_view = unsafe { &*(platform.inner() as *const NSView) };
        ns_view.setAlphaValue(0.0);
        NSAnimationContext::beginGrouping();
        NSAnimationContext::currentContext().setDuration(0.16);
        ns_view.animator().setAlphaValue(1.0);
        NSAnimationContext::endGrouping();
    });
}

#[cfg(not(target_os = "macos"))]
fn fade_in(_view: &Webview) {}

/// Referme la page en fondu, avant de la cacher.
#[cfg(target_os = "macos")]
fn fade_out(view: &Webview) {
    use objc2_app_kit::{NSAnimatablePropertyContainer, NSAnimationContext, NSView};

    let _ = view.with_webview(|platform| {
        let ns_view = unsafe { &*(platform.inner() as *const NSView) };
        NSAnimationContext::beginGrouping();
        NSAnimationContext::currentContext().setDuration(0.09);
        ns_view.animator().setAlphaValue(0.0);
        NSAnimationContext::endGrouping();
    });
}

#[cfg(not(target_os = "macos"))]
fn fade_out(_view: &Webview) {}

/// Remontre la vue et invalide tout masquage différé encore en vol.
fn reveal(pages: &Pages, tile: &str, view: &Webview) -> Result<(), String> {
    next_generation(pages, tile);
    view.show().map_err(crate::storage::message)?;
    fade_in(view);
    Ok(())
}

fn next_generation(pages: &Pages, tile: &str) -> u64 {
    let value = pages.counter.fetch_add(1, Ordering::Relaxed) + 1;
    if let Ok(mut map) = pages.generation.lock() {
        map.insert(tile.to_string(), value);
    }
    value
}

fn is_current(pages: &Pages, tile: &str, generation: u64) -> bool {
    pages
        .generation
        .lock()
        .map(|map| map.get(tile).copied() == Some(generation))
        .unwrap_or(false)
}

fn page(pages: &Pages, tile: &str) -> Result<Webview, String> {
    let id = tile_id(tile)?;
    pages
        .views
        .lock()
        .map_err(crate::storage::message)?
        .get(&id)
        .cloned()
        .ok_or_else(|| "Vue web fermée.".to_string())
}

fn build(
    app: &AppHandle,
    tile: &str,
    label: String,
    url: Url,
    profile: PathBuf,
) -> tauri::webview::WebviewBuilder<tauri::Wry> {
    tauri::webview::WebviewBuilder::new(label, WebviewUrl::External(url))
        .data_directory(profile)
        .incognito(false)
        .zoom_hotkeys_enabled(false)
        .initialization_script_for_all_frames(PAGE_SCRIPT)
        .on_navigation(allowed)
        .on_download({
            let app = app.clone();
            let tile = tile.to_string();
            move |_view, event| {
                if let DownloadEvent::Requested { .. } = event {
                    emit(
                        &app,
                        WebState {
                            tile: tile.clone(),
                            url: None,
                            title: None,
                            loading: None,
                            notice: Some("download".into()),
                        },
                    );
                }
                false
            }
        })
        .on_new_window({
            let app = app.clone();
            let tile = tile.to_string();
            move |url, _features| {
                let _ = app.emit_to(
                    "main",
                    POPUP_EVENT,
                    Popup {
                        tile: tile.clone(),
                        url: url.to_string(),
                    },
                );
                NewWindowResponse::Deny
            }
        })
        .on_page_load({
            let app = app.clone();
            let tile = tile.to_string();
            move |_view, payload: PageLoadPayload<'_>| {
                emit(
                    &app,
                    WebState {
                        tile: tile.clone(),
                        url: Some(payload.url().to_string()),
                        title: None,
                        loading: Some(payload.event() == PageLoadEvent::Started),
                        notice: None,
                    },
                );
            }
        })
        .on_document_title_changed({
            let app = app.clone();
            let tile = tile.to_string();
            move |_view, title| {
                emit(
                    &app,
                    WebState {
                        tile: tile.clone(),
                        url: None,
                        title: Some(title),
                        loading: None,
                        notice: None,
                    },
                );
            }
        })
}

/// Le script de page. Il tourne au début de chaque document, avant les scripts
/// du site, et couvre deux gestes que la vue native ne fait pas seule :
/// le clic molette sur un lien et le démarrage automatique d’un média.
const PAGE_SCRIPT: &str = r##"(() => {
  const open = (event) => {
    if (event.button !== 1 || event.defaultPrevented) return;
    const target = event.target;
    const anchor =
      target && typeof target.closest === "function"
        ? target.closest("a[href]")
        : null;
    if (!anchor || anchor.hasAttribute("download")) return;
    const href = anchor.getAttribute("href") || "";
    if (!href || href.startsWith("#")) return;
    let url;
    try {
      url = new URL(href, anchor.baseURI);
    } catch (error) {
      return;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return;
    event.preventDefault();
    window.open(url.href, "_blank");
  };
  document.addEventListener("mousedown", open, true);

  // Une page restaurée ne démarre pas sa musique ni sa vidéo : il faut un
  // geste réel dans la page. Wry ouvre le webview avec l’autoplay natif
  // autorisé, et `navigator.userActivation` est déjà actif à l’ouverture sur
  // WebKit : on compte donc nos propres gestes, par document.
  let armed = false;
  const arm = (event) => {
    if (event.isTrusted) armed = true;
  };
  for (const type of ["pointerdown", "mousedown", "keydown", "touchstart"]) {
    document.addEventListener(type, arm, true);
  }
  const allowed = () => armed;
  const autoplay = Object.getOwnPropertyDescriptor(
    HTMLMediaElement.prototype,
    "autoplay",
  );
  if (autoplay && autoplay.set && autoplay.get) {
    Object.defineProperty(HTMLMediaElement.prototype, "autoplay", {
      configurable: true,
      enumerable: autoplay.enumerable,
      get() {
        return allowed() && autoplay.get.call(this);
      },
      set(value) {
        autoplay.set.call(this, allowed() ? value : false);
      },
    });
  }
  const stop = (event) => {
    if (allowed()) return;
    const media = event.target;
    if (media && typeof media.pause === "function" && !media.paused) {
      media.pause();
    }
  };
  document.addEventListener("play", stop, true);
  document.addEventListener("playing", stop, true);
  document.addEventListener("timeupdate", stop, true);
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    if (!allowed()) {
      return Promise.reject(
        new DOMException("Lecture bloquée avant interaction.", "NotAllowedError"),
      );
    }
    return play.apply(this, arguments);
  };
})();"##;

const EXTRACT_SCRIPT: &str = r#"(() => {
  try {
    return JSON.stringify({
      url: location.href,
      title: document.title || "",
      text: document.body ? document.body.innerText : ""
    });
  } catch (error) {
    return JSON.stringify({ url: "", title: "", text: "", error: String(error) });
  }
})()"#;

struct Extracted {
    url: String,
    title: String,
    text: String,
}

/// `eval_with_callback` renvoie le résultat sérialisé en JSON ; une valeur
/// textuelle arrive donc encodée deux fois.
fn decode(raw: &str) -> Result<Extracted, String> {
    let value: serde_json::Value =
        serde_json::from_str(raw).map_err(|error| format!("Réponse illisible : {error}"))?;
    let value = match value {
        serde_json::Value::String(inner) => {
            serde_json::from_str(&inner).map_err(|error| format!("Réponse illisible : {error}"))?
        }
        other => other,
    };
    let field = |name: &str| {
        value
            .get(name)
            .and_then(|item| item.as_str())
            .unwrap_or_default()
            .to_string()
    };
    Ok(Extracted {
        url: field("url"),
        title: field("title"),
        text: field("text"),
    })
}

fn emit(app: &AppHandle, state: WebState) {
    let _ = app.emit_to("main", STATE_EVENT, state);
}

fn rect(x: f64, y: f64, width: f64, height: f64) -> tauri::Rect {
    tauri::Rect {
        position: LogicalPosition::new(x, y).into(),
        size: LogicalSize::new(width.max(0.0), height.max(0.0)).into(),
    }
}

fn profile_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(crate::storage::message)?
        .join("web")
        .join("profile");
    std::fs::create_dir_all(&directory).map_err(crate::storage::message)?;
    Ok(directory)
}

fn tile_id(tile: &str) -> Result<String, String> {
    uuid::Uuid::parse_str(tile)
        .map(|id| id.to_string())
        .map_err(|_| "Tuile invalide.".to_string())
}

/// Une navigation est acceptée si elle reste sur le web public. Le protocole
/// local de Spark et le système de fichiers restent hors d’atteinte.
fn allowed(url: &Url) -> bool {
    match url.scheme() {
        "https" => true,
        "http" => cfg!(debug_assertions),
        "about" => url.as_str() == "about:blank",
        _ => false,
    }
}

/// Accepte une adresse sans schéma en la lisant comme du https.
fn sanitize(input: &str) -> Result<Url, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("Adresse vide.".into());
    }
    let url = match Url::parse(trimmed) {
        Ok(url) => url,
        Err(_) => Url::parse(&format!("https://{trimmed}"))
            .map_err(|error| format!("Adresse invalide : {error}"))?,
    };
    if !allowed(&url) {
        return Err("Seules les adresses https:// sont acceptées.".into());
    }
    Ok(url)
}

/// La multi-vue de Tauri fonctionne sous macOS et Windows ; le positionnement
/// des vues enfants reste cassé sous Linux (tauri#10420).
fn platform_ready() -> bool {
    !cfg!(target_os = "linux")
}

fn unavailable() -> String {
    "Le navigateur intégré attend le correctif de positionnement des vues natives sous Linux (tauri#10420).".into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_public_web_addresses() {
        assert_eq!(
            sanitize("example.org/a?b=1").unwrap().as_str(),
            "https://example.org/a?b=1"
        );
        assert_eq!(
            sanitize("https://example.org").unwrap().as_str(),
            "https://example.org/"
        );
        assert!(sanitize("about:blank").is_ok());
    }

    #[test]
    fn refuses_local_and_empty_addresses() {
        assert!(sanitize("").is_err());
        assert!(sanitize("file:///etc/passwd").is_err());
        assert!(sanitize("asset://localhost/x").is_err());
        assert!(sanitize("javascript:alert(1)").is_err());
        assert!(sanitize("data:text/html,hello").is_err());
    }

    #[test]
    fn only_https_in_release() {
        let http = Url::parse("http://example.org/").unwrap();
        assert_eq!(allowed(&http), cfg!(debug_assertions));
    }

    #[test]
    fn reads_a_double_encoded_answer() {
        let raw = serde_json::to_string(
            &serde_json::to_string(&serde_json::json!({
                "url": "https://example.org/",
                "title": "Exemple",
                "text": "bonjour"
            }))
            .unwrap(),
        )
        .unwrap();
        let page = decode(&raw).unwrap();
        assert_eq!(page.url, "https://example.org/");
        assert_eq!(page.title, "Exemple");
        assert_eq!(page.text, "bonjour");
    }

    #[test]
    fn rejects_unreadable_answers() {
        assert!(decode("nope").is_err());
    }

    #[test]
    fn refuses_non_uuid_tiles() {
        assert!(tile_id("../../etc/passwd").is_err());
        assert!(tile_id("not-a-tile").is_err());
        assert!(tile_id("0b0e0c1a-0000-4000-8000-000000000000").is_ok());
    }
}
