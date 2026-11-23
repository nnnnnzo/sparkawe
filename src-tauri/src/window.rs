use tauri::Window;

/// Applique ou retire la vibrancy native derrière la fenêtre.
/// Sans effet hors macOS : seul le thème transparent l’utilise.
///
/// La commande prend `Window` et non `WebviewWindow` : dès qu’une vue web
/// enfant est attachée à la fenêtre, Tauri ne reconnaît plus l’appelant comme
/// un `WebviewWindow` et refuserait l’invoke.
#[tauri::command]
pub fn set_window_material(window: Window, enabled: bool) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    {
        use tauri::window::{Effect, EffectState, EffectsBuilder};
        if enabled {
            window.set_effects(
                EffectsBuilder::new()
                    .effect(Effect::UnderWindowBackground)
                    .state(EffectState::FollowsWindowActiveState)
                    .radius(10.0)
                    .build(),
            )
        } else {
            window.set_effects(None::<tauri::utils::config::WindowEffectsConfig>)
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, enabled);
        Ok(())
    }
}

/// Aligne l’apparence du système sur le thème de Spark.
///
/// Sur macOS et Linux le thème est celui de l’application ; sur Windows celui
/// de la fenêtre. Les vues web héritent de cette apparence : les pages qui
/// honorent `prefers-color-scheme` passent en sombre avec le thème sombre, et
/// les contrôles natifs restent cohérents avec l’interface.
#[tauri::command]
pub fn set_window_theme(window: Window, dark: bool) -> tauri::Result<()> {
    window.set_theme(Some(if dark {
        tauri::Theme::Dark
    } else {
        tauri::Theme::Light
    }))
}
