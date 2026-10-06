// Native window presentation policy shared by the Tauri and Electron hosts.
// Ratios and caps describe the outer frame in logical pixels, including system decorations.

use serde::Deserialize;
use std::sync::OnceLock;
use tauri::{Manager, Runtime, WebviewWindow};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Policy {
    width_ratio: f64,
    height_ratio: f64,
    pub min_width: f64,
    pub min_height: f64,
    max_width: f64,
    max_height: f64,
    pub fallback_width: f64,
    pub fallback_height: f64,
    edge_margin: f64,
}

pub(crate) fn policy() -> &'static Policy {
    static POLICY: OnceLock<Policy> = OnceLock::new();
    POLICY.get_or_init(|| {
        serde_json::from_str(include_str!("../resources/window-layout.json"))
            .expect("Invalid bundled native window layout policy")
    })
}

impl Policy {
    pub fn outer_size(&self, work_width: f64, work_height: f64) -> (f64, f64) {
        let available_width = (work_width - self.edge_margin * 2.0).floor().max(1.0);
        let available_height = (work_height - self.edge_margin * 2.0).floor().max(1.0);
        (
            (work_width * self.width_ratio).round()
                .clamp(self.min_width, self.max_width).min(available_width),
            (work_height * self.height_ratio).round()
                .clamp(self.min_height, self.max_height).min(available_height),
        )
    }
}

/// Apply the common startup frame before showing a main or connection window.
/// Connection windows follow the main window's monitor; all coordinates remain physical across mixed DPI.
pub(crate) fn apply<R: Runtime>(window: &WebviewWindow<R>) {
    let policy = policy();
    // Decorations are measured on the window's current display before moving it to another DPI scale.
    let window_scale = window.scale_factor().ok()
        .filter(|scale| scale.is_finite() && *scale > 0.0).unwrap_or(1.0);
    let (frame_width, frame_height) = match (window.outer_size(), window.inner_size()) {
        (Ok(outer), Ok(inner)) => (
            outer.width.saturating_sub(inner.width) as f64 / window_scale,
            outer.height.saturating_sub(inner.height) as f64 / window_scale,
        ),
        _ => (0.0, 0.0),
    };
    let monitor = window.app_handle().get_webview_window("main")
        .and_then(|main| main.current_monitor().ok().flatten())
        .or_else(|| window.current_monitor().ok().flatten())
        .or_else(|| window.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        // Keep the fallback outer frame consistent even when the native monitor API is unavailable.
        let _ = window.set_min_size(Some(tauri::LogicalSize::new(
            (policy.min_width - frame_width).max(1.0),
            (policy.min_height - frame_height).max(1.0),
        )));
        let _ = window.set_size(tauri::LogicalSize::new(
            (policy.fallback_width - frame_width).max(1.0),
            (policy.fallback_height - frame_height).max(1.0),
        ));
        return;
    };
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    if !scale.is_finite() || scale <= 0.0 || area.size.width == 0 || area.size.height == 0 {
        return;
    }

    let work_width = area.size.width as f64 / scale;
    let work_height = area.size.height as f64 / scale;
    let (width, height) = policy.outer_size(work_width, work_height);

    // Tauri sizes content, while Electron sizes the outer frame. Deduct the actual native frame to match.
    let inner_width = (width - frame_width).max(1.0);
    let inner_height = (height - frame_height).max(1.0);

    // Move onto the chosen display first. Use physical sizing so a pending DPI-change event cannot use
    // the previous display's scale; relax minimum constraints when a small work area cannot fit them.
    let _ = window.set_position(area.position);
    let _ = window.set_min_size(Some(tauri::PhysicalSize::new(
        ((policy.min_width - frame_width).max(1.0).min(inner_width) * scale).round() as u32,
        ((policy.min_height - frame_height).max(1.0).min(inner_height) * scale).round() as u32,
    )));
    let _ = window.set_size(tauri::PhysicalSize::new(
        (inner_width * scale).round() as u32,
        (inner_height * scale).round() as u32,
    ));

    // Center the measured outer frame, including title bars and borders, within the selected work area.
    let outer = window.outer_size().unwrap_or_else(|_| tauri::PhysicalSize::new(
        (width * scale).round() as u32,
        (height * scale).round() as u32,
    ));
    let x = area.position.x as f64 + (area.size.width as f64 - outer.width as f64).max(0.0) / 2.0;
    let y = area.position.y as f64 + (area.size.height as f64 - outer.height as f64).max(0.0) / 2.0;
    let _ = window.set_position(tauri::PhysicalPosition::new(x.round() as i32, y.round() as i32));
}
