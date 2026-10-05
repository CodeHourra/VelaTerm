//! Return keyboard focus to a WebView when its window is reactivated (Windows only).
//!
//! The `unstable` Tauri feature, required by `Window::add_child` for the built-in browser, builds every
//! webview -- a window's own content included -- through wry's child-webview path. That path skips the parent
//! subclass that forwards `WM_SETFOCUS` into the WebView2 controller, so after Alt+Tab or a taskbar click the
//! keyboard focus stops at the top-level HWND and the page receives no keys until it is clicked.
//!
//! This module restores the forwarding: it remembers which webview last held focus in each window and moves
//! focus back to it when the window becomes active again.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, Manager, Webview};

/// Window label -> label of the webview that last received focus inside it.
fn last_focused() -> &'static Mutex<HashMap<String, String>> {
    static MAP: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Record focus changes of `webview` so reactivating its window can return focus to it. Call once per
/// webview right after creation; a closed webview's stale entry is harmless because `restore` falls back.
pub fn track(webview: &Webview) {
    let window = webview.window().label().to_string();
    let label = webview.label().to_string();
    let _ = webview.with_webview(move |platform| {
        use webview2_com::FocusChangedEventHandler;
        let handler = FocusChangedEventHandler::create(Box::new(move |_, _| {
            if let Ok(mut map) = last_focused().lock() {
                map.insert(window.clone(), label.clone());
            }
            Ok(())
        }));
        let mut token = 0i64;
        // SAFETY: with_webview runs on the main thread and wry owns the live WebView2 controller.
        unsafe {
            let _ = platform.controller().add_GotFocus(&handler, &mut token);
        }
    });
}

/// Drop `label` as a focus target once it is hidden or closed, so reactivation does not focus an invisible
/// webview.
pub fn forget(label: &str) {
    if let Ok(mut map) = last_focused().lock() {
        map.retain(|_, focused| focused != label);
    }
}

/// Move keyboard focus into the window's last focused webview, falling back to its content webview.
pub fn restore(app: &AppHandle, window_label: &str) {
    let app_handle = app.clone();
    let window_label = window_label.to_string();
    // tao reports activation from WM_NCACTIVATE, before DefWindowProc handles WM_ACTIVATE and gives focus to
    // the top-level window. Posting the move runs it after that, so it is not overridden.
    let _ = app.run_on_main_thread(move || {
        let Some(window) = app_handle.get_window(&window_label) else {
            return;
        };
        let remembered = last_focused()
            .lock()
            .ok()
            .and_then(|map| map.get(&window_label).cloned());
        let target = remembered
            .and_then(|label| app_handle.get_webview(&label))
            .filter(|wv| wv.window().label() == window_label)
            .or_else(|| app_handle.get_webview(&window_label))
            .or_else(|| window.webviews().into_iter().next());
        if let Some(wv) = target {
            let _ = wv.set_focus();
        }
    });
}
