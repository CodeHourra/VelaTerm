//! Context windows from the model catalogue Claude Code itself uses.
//!
//! Claude Code reads each model's window from `runtime.max_input_tokens` in a catalogue Anthropic publishes
//! without authentication, and keeps a copy under `<claude home>/cache/model-catalog/published-*.json`.
//! Neither location is documented, so every read is defensive: any object carrying an `id` and a
//! `runtime.max_input_tokens` counts, whatever it is nested in, and anything unreadable yields no answer.
//!
//! A downloaded copy takes precedence over the CLI's local copy, which can be days old. The download runs
//! on a background thread when a lookup misses or the copy is stale, so a lookup never waits on the network.

use std::collections::HashMap;
use std::io::Read;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};

use serde_json::Value;

const URL: &str = "https://downloads.claude.ai/model-catalog/v1/catalog.json";
/// Upper bound on a catalogue document; the published one is about 150 KB.
const LIMIT: u64 = 4 * 1024 * 1024;
/// A download older than this is refreshed on the next lookup.
const FRESH_FOR: Duration = Duration::from_secs(24 * 60 * 60);
/// Minimum spacing between download attempts, so a model the catalogue lacks does not cause a request on
/// every Info panel refresh.
const RETRY_AFTER: Duration = Duration::from_secs(10 * 60);

#[derive(Default)]
struct State {
    downloaded: Option<(Instant, HashMap<String, u64>)>,
    attempted: Option<Instant>,
    fetching: bool,
    /// The CLI's local copy, keyed by the file and its modification time so it is parsed once per change.
    local: Option<(PathBuf, SystemTime, HashMap<String, u64>)>,
}

static STATE: Mutex<Option<State>> = Mutex::new(None);

/// Context window for `model`, or None when neither copy of the catalogue lists it.
pub fn context_window(model: &str, same_model: impl Fn(&str, &str) -> bool) -> Option<u64> {
    let mut guard = STATE.lock().unwrap();
    let state = guard.get_or_insert_with(State::default);
    if !cfg!(test) {
        refresh_local(state);
    }
    let lookup = |windows: &HashMap<String, u64>| {
        windows.get(model).copied().or_else(|| {
            windows.iter().find(|(id, _)| same_model(id, model)).map(|(_, w)| *w)
        })
    };
    let found = state
        .downloaded
        .as_ref()
        .and_then(|(_, windows)| lookup(windows))
        .or_else(|| state.local.as_ref().and_then(|(_, _, windows)| lookup(windows)));
    let stale = state.downloaded.as_ref().is_none_or(|(at, _)| at.elapsed() >= FRESH_FOR);
    let may_retry = state.attempted.is_none_or(|at| at.elapsed() >= RETRY_AFTER);
    if (found.is_none() || stale) && may_retry && !state.fetching && !cfg!(test) {
        state.fetching = true;
        state.attempted = Some(Instant::now());
        std::thread::spawn(fetch);
    }
    found
}

/// Reparse the CLI's newest local copy when it changed since the last read.
fn refresh_local(state: &mut State) {
    let Some(dir) = super::resume::claude_home().map(|h| h.join("cache").join("model-catalog")) else {
        return;
    };
    let newest = std::fs::read_dir(&dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| {
            let name = e.file_name();
            let name = name.to_string_lossy();
            name.starts_with("published-") && name.ends_with(".json") && name != "published-floor.json"
        })
        .filter_map(|e| Some((e.path(), e.metadata().ok()?.modified().ok()?)))
        .max_by_key(|(_, modified)| *modified);
    let Some((path, modified)) = newest else {
        return;
    };
    if state.local.as_ref().is_some_and(|(p, m, _)| *p == path && *m == modified) {
        return;
    }
    let windows = std::fs::metadata(&path)
        .ok()
        .filter(|m| m.len() <= LIMIT)
        .and_then(|_| std::fs::read(&path).ok())
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .map(|doc| windows(&doc))
        .unwrap_or_default();
    state.local = Some((path, modified, windows));
}

fn fetch() {
    let result = download();
    let mut guard = STATE.lock().unwrap();
    let state = guard.get_or_insert_with(State::default);
    state.fetching = false;
    if let Some(windows) = result.filter(|w| !w.is_empty()) {
        state.downloaded = Some((Instant::now(), windows));
    }
}

fn download() -> Option<HashMap<String, u64>> {
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(10)).redirects(0).build();
    let response = agent.get(URL).set("Accept", "application/json").call().ok()?;
    if response.status() != 200 {
        return None;
    }
    let mut bytes = Vec::new();
    response.into_reader().take(LIMIT + 1).read_to_end(&mut bytes).ok()?;
    if bytes.len() as u64 > LIMIT {
        return None;
    }
    let doc: Value = serde_json::from_slice(&bytes).ok()?;
    Some(windows(&doc))
}

/// Every `id` → `runtime.max_input_tokens` pair in a catalogue document, wherever it is nested. The first
/// occurrence of an id wins; implausible sizes are skipped.
fn windows(doc: &Value) -> HashMap<String, u64> {
    fn walk(value: &Value, out: &mut HashMap<String, u64>) {
        match value {
            Value::Object(map) => {
                let id = map.get("id").and_then(Value::as_str);
                let window = map
                    .get("runtime")
                    .and_then(|r| r.get("max_input_tokens"))
                    .and_then(Value::as_u64)
                    .filter(|&n| (1_000..=100_000_000).contains(&n));
                if let (Some(id), Some(window)) = (id, window) {
                    out.entry(id.to_string()).or_insert(window);
                    return;
                }
                map.values().for_each(|v| walk(v, out));
            }
            Value::Array(items) => items.iter().for_each(|v| walk(v, out)),
            _ => {}
        }
    }
    let mut out = HashMap::new();
    walk(doc, &mut out);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_are_found_at_any_depth_and_implausible_sizes_are_skipped() {
        let doc = serde_json::json!({
            "schema_version": 1,
            "surfaces": {"cc": {"models": [
                {"id": "claude-opus-5-5", "runtime": {"max_input_tokens": 1_000_000}},
                {"id": "claude-haiku-4-5-20251001", "runtime": {"max_input_tokens": 200_000}},
                {"id": "claude-no-runtime", "name": "No runtime"},
                {"id": "claude-zero", "runtime": {"max_input_tokens": 0}}
            ]}},
            "document": {"models": [{"id": "claude-opus-5-5", "runtime": {"max_input_tokens": 200_000}}]}
        });
        let found = windows(&doc);
        assert_eq!(found.get("claude-haiku-4-5-20251001"), Some(&200_000));
        assert!(found.contains_key("claude-opus-5-5"));
        assert!(!found.contains_key("claude-no-runtime"));
        assert!(!found.contains_key("claude-zero"));
        assert!(windows(&serde_json::json!({"unexpected": [1, "two", null]})).is_empty());
    }

    /// Reads the CLI's local copy and downloads the published catalogue on this machine.
    #[test]
    #[ignore = "depends on the local Claude cache and network access"]
    fn real_catalogue_smoke() {
        let mut state = State::default();
        refresh_local(&mut state);
        let local = state.local.map(|(path, _, windows)| (path, windows));
        eprintln!("local: {:?}", local.as_ref().map(|(p, w)| (p, w.get("claude-opus-5-5"), w.len())));
        let downloaded = download().expect("download failed");
        eprintln!("downloaded: opus-5-5={:?} sonnet-5-5={:?} count={}",
            downloaded.get("claude-opus-5-5"), downloaded.get("claude-sonnet-5-5"), downloaded.len());
        assert_eq!(downloaded.get("claude-opus-5-5"), Some(&1_000_000));
    }
}
