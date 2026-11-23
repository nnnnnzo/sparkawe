//! Menus du système, pour les actions qui doivent passer au-dessus d’une vue
//! web native.
//!
//! Une couche DOM ne peut pas recouvrir une vue native : le menu de
//! déplacement d’une tuile est donc un menu du système, dessiné par la
//! plateforme au-dessus de tout.

use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    Manager, Window,
};

#[derive(serde::Deserialize)]
pub struct MenuLabel {
    id: String,
    text: String,
}

/// Ouvre le menu de déplacement d’une tuile au curseur.
#[tauri::command]
pub fn popup_tile_menu(window: Window, tile: String, items: Vec<MenuLabel>) -> Result<(), String> {
    let app = window.app_handle();
    let mut builder = MenuBuilder::new(app);
    for item in &items {
        if item.id.is_empty() {
            continue;
        }
        let entry =
            MenuItemBuilder::with_id(format!("spark.tile.move.{tile}.{}", item.id), &item.text)
                .build(app)
                .map_err(|error| error.to_string())?;
        builder = builder.item(&entry);
    }
    let menu = builder.build().map_err(|error| error.to_string())?;
    window.popup_menu(&menu).map_err(|error| error.to_string())
}
