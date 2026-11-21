use tauri::WebviewWindow;

/// Applique ou retire la vibrancy native derrière la fenêtre.
/// Sans effet hors macOS : seul le thème transparent l’utilise.
#[tauri::command]
pub fn set_window_material(window: WebviewWindow, enabled: bool) -> tauri::Result<()> {
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
