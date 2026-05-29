//! Tray icon + menu and the global hotkey-triggered quick-prompt
//! window.
//!
//! Tray menu items emit a `tray.action` event the React layer listens
//! for so the menu plumbing stays declarative on the Rust side.
//! The quick-prompt window is a small frameless surface that loads
//! `/?window=quick-prompt`; the React app inside reads that label and
//! renders the dedicated micro-UI.

use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

/// Stable event names the React tray-listener subscribes to.
pub mod events {
    pub const TRAY_ACTION: &str = "tray.action";
    pub const QUICK_PROMPT_OPENED: &str = "quick-prompt.opened";
}

/// Sentinel labels for the tray menu items. Matches what JS expects in
/// the `tray.action` event payload.
pub mod actions {
    pub const QUICK_PROMPT: &str = "quick-prompt";
    pub const OPEN_MAIN: &str = "open-main";
    pub const NEW_WINDOW: &str = "new-window";
    pub const QUIT: &str = "quit";
}

pub const QUICK_PROMPT_LABEL: &str = "quick-prompt";

/// Install the tray icon. Returns the live [`TrayIcon`] so the caller
/// can hold it inside Tauri's managed state — dropping it removes the
/// icon from the OS tray.
pub fn install<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<TrayIcon<R>> {
    let menu = build_menu(app)?;
    let mut builder = TrayIconBuilder::with_id("moxxy-tray")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .tooltip("moxxy")
        .on_menu_event(handle_menu_event::<R>)
        .on_tray_icon_event(handle_tray_event::<R>);
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    builder.build(app)
}

fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let quick = MenuItem::with_id(
        app,
        actions::QUICK_PROMPT,
        "Quick prompt",
        true,
        Some("CmdOrCtrl+Shift+Space"),
    )?;
    let open_main = MenuItem::with_id(
        app,
        actions::OPEN_MAIN,
        "Open moxxy",
        true,
        None::<&str>,
    )?;
    let new_win = MenuItem::with_id(
        app,
        actions::NEW_WINDOW,
        "New window",
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, actions::QUIT, "Quit", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    Menu::with_items(app, &[&quick, &open_main, &new_win, &sep, &quit])
}

fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    let id = event.id.as_ref();
    let _ = app.emit(events::TRAY_ACTION, id.to_string());
    match id {
        a if a == actions::QUICK_PROMPT => {
            if let Err(e) = open_quick_prompt(app) {
                tracing::warn!(error = %e, "open quick-prompt");
            }
        }
        a if a == actions::OPEN_MAIN => focus_main(app),
        a if a == actions::QUIT => app.exit(0),
        _ => {}
    }
}

fn handle_tray_event<R: Runtime>(_tray: &TrayIcon<R>, _event: TrayIconEvent) {
    // Reserved for future left-click → open-main behaviour. The menu
    // already handles the typical case so we don't need anything here
    // for v1.
}

fn focus_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Open or focus the quick-prompt window. A 480×140 frameless surface
/// pinned to the top — single-prompt entry, dismisses on blur.
pub fn open_quick_prompt<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window(QUICK_PROMPT_LABEL) {
        w.show()?;
        w.set_focus()?;
        let _ = app.emit(events::QUICK_PROMPT_OPENED, true);
        return Ok(());
    }
    let url = format!("/?window={QUICK_PROMPT_LABEL}");
    let parsed: WebviewUrl = WebviewUrl::App(url.parse().unwrap_or_default());
    WebviewWindowBuilder::new(app, QUICK_PROMPT_LABEL, parsed)
        .title("moxxy quick prompt")
        .inner_size(480.0, 140.0)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .build()?;
    let _ = app.emit(events::QUICK_PROMPT_OPENED, true);
    Ok(())
}

/// Register the global hotkey (Cmd/Ctrl+Shift+Space by default) that
/// toggles the quick-prompt window. Failures (already bound by another
/// app, OS rejection) surface as a `runner.error` event so the user
/// gets a clear message rather than silent breakage.
pub fn register_global_hotkey<R: Runtime>(app: &AppHandle<R>) {
    use tauri_plugin_global_shortcut::{
        Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
    };

    let shortcut = Shortcut::new(
        Some(Modifiers::SHIFT | Modifiers::SUPER),
        Code::Space,
    );
    let handle = app.clone();
    let result = app.global_shortcut().on_shortcut(shortcut, move |_app, sc, ev| {
        // Fire on key-press, not release, so a long press doesn't
        // toggle twice.
        if ev.state == ShortcutState::Pressed && *sc == shortcut {
            if let Err(e) = open_quick_prompt(&handle) {
                tracing::warn!(error = %e, "hotkey open quick-prompt");
            }
        }
    });

    if let Err(e) = result {
        tracing::warn!(error = %e, "register global hotkey");
        let _ = app.emit(
            crate::boot::events::RUNNER_ERROR,
            format!("global hotkey rejected: {e}"),
        );
    }
}
