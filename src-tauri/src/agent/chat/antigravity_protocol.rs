//! Antigravity's persistent NDJSON driver and its native step transcript.

use std::collections::HashMap;
use serde_json::{json, Value};
use super::engine::ChatRow;

pub const EFFORTS: &[&str] = &["low", "medium", "high", "max"];

pub fn launch_args(resume: Option<&str>, model: Option<&str>, effort: Option<&str>, mode: &str,
    extra: &[String]) -> Result<Vec<String>, String> {
    if effort.is_some_and(|value| !EFFORTS.contains(&value)) {
        return Err("Antigravity effort must be low, medium, high, max, or automatic".into());
    }
    let mut args = vec!["--input-format".into(), "stream-json".into(),
        "--output-format".into(), "stream-json".into()];
    for (flag, value) in [("--conversation", resume), ("--model", model), ("--effort", effort)] {
        if let Some(value) = value { args.extend([flag.into(), value.into()]); }
    }
    if mode == "bypassPermissions" { args.push("--dangerously-skip-permissions".into()); }
    // A custom argument must not replace the native conversation or the framing this driver owns.
    for arg in extra {
        let flag = arg.split('=').next().unwrap_or(arg);
        if matches!(flag, "--input-format" | "--output-format" | "--conversation" | "--continue" |
            "-c" | "--print" | "--prompt" | "-p" | "--prompt-interactive" | "-i" | "--remote-control") {
            return Err(format!("Antigravity conversation view manages {flag}; remove it from custom arguments"));
        }
    }
    args.extend_from_slice(extra);
    Ok(args)
}

pub fn validate(text: &str, image_count: usize, behavior: &str) -> Result<(), String> {
    if image_count > 0 { return Err("Antigravity conversation view currently supports text messages only".into()); }
    if behavior == "steer" { return Err("Antigravity does not support steering; queue the message instead".into()); }
    // Native CLI commands bypass NDJSON and would terminate a persistent input stream.
    if text.trim_start().starts_with('/') {
        return Err("Antigravity slash commands are unavailable in conversation view; use the terminal view".into());
    }
    Ok(())
}

pub fn user_message(text: &str) -> Value { json!({"event":"user","message":{"content":text}}) }

/// Preserve native parameters while adding the presentation fields used by existing tool cards.
pub fn tool_input(name: &str, parameters: &Value) -> (String, Value) {
    let mut input = parameters.clone();
    let aliases: &[(&str, &str)] = match name {
        "run_command" => &[("CommandLine", "command"), ("Cwd", "cwd")],
        "view_file" => &[("AbsolutePath", "file_path")],
        "write_to_file" => &[("TargetFile", "file_path"), ("CodeContent", "content")],
        "replace_file_content" => &[("TargetFile", "file_path"), ("TargetContent", "old_string"), ("ReplacementContent", "new_string")],
        "grep_search" => &[("SearchPath", "path"), ("Query", "pattern")],
        "find_by_name" => &[("SearchDirectory", "path"), ("Pattern", "pattern")],
        _ => &[],
    };
    if let Some(object) = input.as_object_mut() {
        for (source, target) in aliases {
            if let Some(value) = parameters.get(source) { object.insert((*target).into(), value.clone()); }
        }
    }
    let name = match name {
        "run_command" => "Bash", "view_file" => "Read", "write_to_file" => "Write",
        "replace_file_content" => "Edit", "grep_search" => "Grep", "find_by_name" => "Glob",
        _ => name,
    };
    (name.into(), input)
}

pub fn tool_row(id: String, name: &str, input: &Value, output: Option<String>, error: bool, done: bool) -> ChatRow {
    let (name, input) = tool_input(name, input);
    ChatRow::Tool { id, name, input, output, is_error: error,
        status: if error { "failed" } else if done { "completed" } else { "running" },
        subagent: None, children: Vec::new() }
}

pub fn step_id(index: u64) -> String { format!("agy-step-{index}") }

#[derive(Default)]
pub struct StreamState {
    text: HashMap<String, String>,
    pub last_answer: Option<String>,
}

impl StreamState {
    pub fn begin_turn(&mut self) { self.text.clear(); self.last_answer = None; }

    pub fn step(&mut self, step: &Value, model: Option<String>) -> Option<ChatRow> {
        let id = step_id(step.get("step_index")?.as_u64()?);
        let done = step.get("state").and_then(Value::as_str) == Some("DONE");
        match step.get("step_type")?.as_str()? {
            "agent_response" => {
                let text = self.text.entry(id.clone()).or_default();
                if let Some(delta) = step.get("text_delta").and_then(Value::as_str) { text.push_str(delta); }
                if text.is_empty() { return None; }
                self.last_answer = Some(id.clone());
                Some(ChatRow::Assistant { id, text: text.clone(), streaming: !done, model, at: None, duration_ms: None })
            }
            "tool" => {
                let info = step.get("tool_info").or_else(|| step.get("subagent_info"));
                let name = step.get("tool_name").and_then(Value::as_str)
                    .or_else(|| info?.get("name")?.as_str()).unwrap_or("Antigravity tool");
                let error = info.and_then(|v| v.get("error")).filter(|v| !v.is_null());
                let output = info.and_then(|v| v.get("output")).filter(|v| !v.is_null())
                    .map(|v| v.as_str().map(str::to_owned).unwrap_or_else(|| v.to_string()))
                    .or_else(|| error.map(|v| v.get("message").and_then(Value::as_str).map(str::to_owned).unwrap_or_else(|| v.to_string())))
                    .or_else(|| step.get("subagent_info").map(|v| v.to_string()));
                Some(tool_row(id, name, &info.and_then(|v| v.get("parameters")).cloned().unwrap_or_else(|| json!({})),
                    output, error.is_some(), done))
            }
            _ => None,
        }
    }

    /// Native duration includes previous turns and idle time; the engine times the active turn itself.
    pub fn result(&mut self, result: &Value, model: Option<String>) -> Option<ChatRow> {
        let response = result.get("response").and_then(Value::as_str).unwrap_or("");
        if self.last_answer.is_none() && !response.is_empty() {
            Some(ChatRow::Assistant { id: format!("agy-result-{}", result.get("num_turns").and_then(Value::as_u64).unwrap_or(0)),
                text: response.into(), streaming: false, model, at: None, duration_ms: None })
        } else { None }
    }
}

/// Read the genuine user request, excluding runtime metadata and setting-change annotations.
pub fn user_request(content: &str) -> Option<String> {
    let text = if let Some((_, rest)) = content.split_once("<USER_REQUEST>") {
        rest.split_once("</USER_REQUEST>")?.0
    } else { content };
    let text = text.trim();
    (!text.is_empty()).then(|| text.to_string())
}

pub fn history_rows(content: &str) -> Vec<ChatRow> {
    let mut rows = Vec::new();
    let mut pending = std::collections::VecDeque::new();
    for line in content.lines() {
        let Ok(step) = serde_json::from_str::<Value>(line) else { continue };
        let Some(index) = step.get("step_index").and_then(Value::as_u64) else { continue };
        let id = step_id(index);
        let at = super::history::parsed_at(step.get("created_at").and_then(Value::as_str));
        let text = step.get("content").and_then(Value::as_str).unwrap_or("");
        let done = step.get("status").and_then(Value::as_str) == Some("DONE");
        match step.get("type").and_then(Value::as_str) {
            Some("USER_INPUT") => {
                pending.clear();
                if let Some(text) = user_request(text) {
                    rows.push(super::engine::user_row(id, &text, Vec::new(), at));
                }
            }
            Some("PLANNER_RESPONSE") => {
                if let Some(thinking) = step.get("thinking").and_then(Value::as_str).filter(|v| !v.is_empty()) {
                    rows.push(ChatRow::Reasoning { id: format!("{id}-thinking"), text: thinking.into(), streaming: !done });
                }
                if !text.is_empty() {
                    rows.push(ChatRow::Assistant { id: id.clone(), text: text.into(), streaming: !done, model: None, at, duration_ms: None });
                }
                for (ordinal, call) in step.get("tool_calls").and_then(Value::as_array).into_iter().flatten().enumerate() {
                    let Some(name) = call.get("name").and_then(Value::as_str) else { continue };
                    let position = rows.len();
                    rows.push(tool_row(format!("{id}-call-{ordinal}"), name, &call.get("args").cloned().unwrap_or_else(|| json!({})), None, false, false));
                    pending.push_back(position);
                }
            }
            Some("ERROR_MESSAGE") => {
                if let Some(position) = pending.pop_front() {
                    if let ChatRow::Tool { output, is_error, status, .. } = &mut rows[position] {
                        *output = Some(text.into()); *is_error = true; *status = "failed";
                    }
                } else if !text.is_empty() { rows.push(ChatRow::Error { id, message: text.into() }); }
            }
            // Native tool results have several category names; only pair them with a recorded call.
            Some("GENERIC" | "LIST_DIRECTORY" | "VIEW_FILE" | "CODE_ACTION") => {
                if let Some(position) = pending.pop_front() {
                    if let ChatRow::Tool { id: tool_id, output, status, .. } = &mut rows[position] {
                        *tool_id = id; *output = Some(text.into());
                        *status = if done { "completed" } else { "running" };
                    }
                }
            }
            _ => {},
        }
    }
    rows
}

/// The same parsed context feeds archive viewing, search and Markdown export.
pub(crate) fn events(content: &str) -> Vec<crate::agent::export::Event> {
    use crate::agent::export::Event;
    let timestamps: HashMap<_, _> = content.lines().filter_map(|line| {
        let step: Value = serde_json::from_str(line).ok()?;
        Some((step_id(step.get("step_index")?.as_u64()?), step.get("created_at")?.as_str()?.to_string()))
    }).collect();
    let mut events = Vec::new();
    for row in history_rows(content) {
        let id = match &row {
            ChatRow::User { id, .. } | ChatRow::Assistant { id, .. } | ChatRow::Reasoning { id, .. }
            | ChatRow::Tool { id, .. } | ChatRow::Error { id, .. } | ChatRow::Shell { id, .. } => id,
            _ => continue,
        };
        let base = id.split("-thinking").next().unwrap_or(id).split("-call-").next().unwrap_or(id);
        let ts = timestamps.get(base).cloned();
        match row {
            ChatRow::User { text, .. } => events.push(Event::User { text, ts: ts.clone() }),
            ChatRow::Assistant { text, .. } => events.push(Event::AssistantText { text, ts: ts.clone() }),
            ChatRow::Reasoning { text, .. } => events.push(Event::Thinking { text, ts: ts.clone() }),
            ChatRow::Tool { id, name, input, output, is_error, .. } => {
                events.push(Event::ToolUse { id: Some(id.clone()), name: name.clone(), input, ts: ts.clone() });
                if let Some(text) = output { events.push(Event::ToolResult { id: Some(id), name: Some(name), text, is_error }); }
            }
            ChatRow::Error { message, .. } => events.push(Event::Command { text: message, ts: ts.clone() }),
            ChatRow::Shell { id, command, stdout, exit_code, status, stdout_truncated, .. } => {
                events.push(Event::Shell { id: Some(id), command, output: stdout, exit_code,
                    cancelled: status == "cancelled", truncated: stdout_truncated, ts: ts.clone() });
            }
            _ => {},
        }
    }
    events
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_deltas_and_result_fallback_do_not_duplicate_answers() {
        let mut state = StreamState::default();
        for (delta, done) in [("hel", false), ("lo", true)] {
            let row = state.step(&json!({"step_index":1,"step_type":"agent_response","state":if done{"DONE"}else{"ACTIVE"},"text_delta":delta}), None).unwrap();
            if let ChatRow::Assistant { text, streaming, .. } = row { assert_eq!(streaming, !done); assert!("hello".starts_with(&text)); } else { panic!(); }
        }
        assert!(state.result(&json!({"response":"hello","duration_seconds":3.0}), None).is_none());
        state.begin_turn();
        let row = state.result(&json!({"response":"again","num_turns":2,"duration_seconds":5.5}), None);
        assert!(matches!(row, Some(ChatRow::Assistant { text, .. }) if text == "again"));
    }

    #[test]
    fn tool_failure_and_native_parameters_are_preserved() {
        let mut state = StreamState::default();
        let row = state.step(&json!({"step_index":4,"step_type":"tool","state":"DONE","tool_info":{"name":"run_command","parameters":{"CommandLine":"echo hi"},"error":{"message":"Permission denied"}}}), None).unwrap();
        assert!(matches!(row, ChatRow::Tool { name, input, output, status:"failed", .. }
            if name == "Bash" && input["command"] == "echo hi" && input["CommandLine"] == "echo hi" && output.as_deref() == Some("Permission denied")));
    }

    #[test]
    fn replay_excludes_metadata_and_pairs_the_tool_result() {
        let lines = [json!({"step_index":0,"type":"USER_INPUT","content":"<USER_REQUEST>test</USER_REQUEST><ADDITIONAL_METADATA>private</ADDITIONAL_METADATA>"}),
            json!({"step_index":1,"type":"PLANNER_RESPONSE","tool_calls":[{"name":"view_file","args":{"AbsolutePath":"/tmp/test"}}]}),
            json!({"step_index":2,"type":"GENERIC","status":"DONE","content":"file contents"}),
            json!({"step_index":3,"type":"PLANNER_RESPONSE","status":"DONE","content":"answer","thinking":"reason"})];
        let rows = history_rows(&lines.iter().map(Value::to_string).collect::<Vec<_>>().join("\n"));
        assert_eq!(rows.len(), 4);
        assert!(matches!(&rows[0], ChatRow::User { text, .. } if text == "test"));
        assert!(matches!(&rows[1], ChatRow::Tool { id, name, output, status:"completed", .. }
            if id == "agy-step-2" && name == "Read" && output.as_deref() == Some("file contents")));
    }

    #[test]
    fn unsupported_input_and_protocol_overrides_are_rejected() {
        assert!(validate("hello", 1, "queue").is_err());
        assert!(validate("hello", 0, "steer").is_err());
        assert!(validate("/model", 0, "queue").is_err());
        assert!(launch_args(None, None, None, "default", &["--output-format=text".into()]).is_err());
        let args = launch_args(Some("native"), Some("model"), Some("high"), "default", &[]).unwrap();
        assert!(!args.iter().any(|v| v == "--dangerously-skip-permissions"));
        assert!(args.windows(2).any(|v| v == ["--conversation", "native"]));
    }
}
