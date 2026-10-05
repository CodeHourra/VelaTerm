//! Read-only session identity, hierarchy and stored properties shared by vself and vflow.

use crate::{db::repo, host::AppCtx};
use rusqlite::OptionalExtension;
use serde_json::{json, Value};

pub(super) fn resolve(app: &AppCtx, caller: &str, target: Option<&str>) -> Result<String, String> {
    let conn = app.db().conn.lock().unwrap();
    repo::get_session(&conn, caller)?.ok_or("Calling session not found")?;
    match target {
        None => Ok(caller.to_owned()),
        Some(target) if target.trim().is_empty() => Err("Specify a target session".into()),
        Some(target) => match repo::resolve_session_ref(&conn, target)? {
            repo::SessionRefMatch::One(id) => Ok(id),
            repo::SessionRefMatch::None => Err("Target session not found".into()),
            repo::SessionRefMatch::Ambiguous(candidates) => Err(format!(
                "Ambiguous target; use a session ID:\n{}", candidates.iter()
                    .map(|(id,name)|format!("{id}  {name}")).collect::<Vec<_>>().join("\n"))),
        },
    }
}

pub(super) fn children(app: &AppCtx, id: &str) -> Result<Vec<String>, String> {
    let conn = app.db().conn.lock().unwrap();
    let mut query = conn.prepare("SELECT id FROM sessions WHERE parent_session_id=?1 ORDER BY sort_order,created_at,id").map_err(|e|e.to_string())?;
    let rows = query.query_map([id], |r|r.get::<_,String>(0)).map_err(|e|e.to_string())?;
    rows.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())
}

pub(super) fn describe(app: &AppCtx, id: &str) -> Result<Value, String> {
    let conn = app.db().conn.lock().unwrap();
    let saved = repo::get_session(&conn, id)?.ok_or("Session not found")?;
    let mut result = serde_json::to_value(&saved).map_err(|e|e.to_string())?;
    result["sessionId"] = json!(saved.id);
    result["archived"] = json!(saved.archived_at.is_some());
    result["forkPending"] = json!(repo::get_fork_pending(&conn, id)?);
    let mut redacted = Vec::new();
    // Free-form launch input and environment values can contain credentials. Keep property presence
    // and environment names, but never send their raw values into another agent's transcript.
    for key in ["envJson", "initCmd", "agentArgs"] {
        if !result[key].is_null() {
            result[key] = if key == "envJson" {
                saved.env_json.as_deref().and_then(|s|serde_json::from_str::<Value>(s).ok())
                    .and_then(|v|v.as_object().map(|m|m.keys().map(|k|(k.clone(),json!("[redacted]"))).collect::<serde_json::Map<_,_>>()))
                    .map(|m|json!(Value::Object(m).to_string())).unwrap_or_else(||json!("[redacted]"))
            } else { json!("[redacted]") };
            redacted.push(key);
        }
    }
    if let Some(raw) = saved.browser_url.as_deref() {
        if let Ok(mut url) = url::Url::parse(raw) {
            if !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() {
                let _ = url.set_username("");
                let _ = url.set_password(None);
                url.set_query(None);
                url.set_fragment(None);
                result["browserUrl"] = json!(url.as_str());
                redacted.push("browserUrl");
            }
        } else {
            result["browserUrl"] = json!("[redacted]");
            redacted.push("browserUrl");
        }
    }
    result["redactedFields"] = json!(redacted);
    result["modelSettings"] = json!(super::session_settings::stored(&conn, id)?.map(|(selection,_)|selection));
    result["launchModelSettings"] = json!(super::session_settings::from_args(saved.kind, saved.agent_args.as_deref()));
    let (tier, personality) = repo::codex_chat_settings(&conn, id)?;
    result["codexSettings"] = json!({"serviceTier":tier,"personality":personality});
    let chrome: Option<Option<bool>> = conn.query_row("SELECT chrome FROM chat_claude_settings WHERE session_id=?1", [id], |r|r.get(0))
        .optional().map_err(|e|e.to_string())?;
    result["claudeSettings"] = json!({"chrome":chrome.flatten()});
    let continuation: Option<Value> = conn.query_row("SELECT continue_at,limit_type,rearms FROM chat_auto_continue WHERE session_id=?1", [id], |r|
        Ok(json!({"continueAt":r.get::<_,i64>(0)?,"limitType":r.get::<_,Option<String>>(1)?,"rearms":r.get::<_,u32>(2)?})))
        .optional().map_err(|e|e.to_string())?;
    result["autoContinue"] = json!(continuation);
    let mut query = conn.prepare("SELECT id FROM plan_execute_runs WHERE owner_id=?1 OR planner_id=?1 OR executor_id=?1 ORDER BY rowid").map_err(|e|e.to_string())?;
    let workflows = query.query_map([id], |r|r.get::<_,String>(0)).map_err(|e|e.to_string())?
        .collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
    result["workflowIds"] = json!(workflows);
    Ok(result)
}

pub(super) fn inspect(app: &AppCtx, caller: &str, target: Option<&str>) -> Result<Value, String> {
    let id = resolve(app, caller, target)?;
    let lineage = repo::session_lineage(&app.db().conn.lock().unwrap(), &id)?;
    let ancestors = lineage.iter().skip(1).map(|s|describe(app,&s.session_id)).collect::<Result<Vec<_>,_>>()?;
    let children = children(app, &id)?.iter().map(|id|describe(app,id)).collect::<Result<Vec<_>,_>>()?;
    Ok(json!({"session":describe(app,&id)?,"parent":ancestors.first(),"ancestors":ancestors,"children":children}))
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;

    pub(crate) const PLAN: &str = "11111111-1111-4111-8111-111111111111";
    pub(crate) const EXEC: &str = "22222222-2222-4222-8222-222222222222";

    pub(crate) fn fixture() -> AppCtx {
        let dir = std::env::temp_dir().join(format!("vlx-session-query-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let db = crate::db::Db::open(&dir.join("fixture.db")).unwrap();
        let app = AppCtx::Headless(std::sync::Arc::new(crate::host::HeadlessHost::new(dir, db)));
        {
            let conn = app.db().conn.lock().unwrap();
            conn.execute("INSERT INTO projects(id,name,root_path,created_at) VALUES ('p','Project','/workspace',0)", []).unwrap();
            conn.execute("INSERT INTO groups(id,project_id,name,created_at) VALUES ('g','p','Group',0)", []).unwrap();
            for (id, name, kind, parent) in [
                ("caller", "Caller", "terminal", None), ("owner", "Owner", "terminal", None),
                (PLAN, "Planning session", "codex", Some("owner")), (EXEC, "Execute", "codex", Some(PLAN)),
                ("legacy", "Ordinary parent", "claude", None), ("legacy-child", "Shell child", "terminal", Some("legacy")),
                ("archived-child", "Browser child", "browser", Some("legacy")), ("grandchild", "Grandchild", "terminal", Some("legacy-child")),
            ] {
                conn.execute("INSERT INTO sessions(id,project_id,group_id,name,kind,parent_session_id,cwd,created_at) VALUES (?1,'p','g',?2,?3,?4,'/workspace',123)",
                    rusqlite::params![id,name,kind,parent]).unwrap();
            }
            conn.execute("UPDATE sessions SET archived_at=456,sort_order=1 WHERE id='archived-child'", []).unwrap();
            conn.execute("INSERT INTO plan_execute_runs(id,owner_id,planner_id,executor_id,config,task,state,round,summary) VALUES ('run','owner',?1,?2,'{}','Implement task','reviewing',2,'Execution report')",
                rusqlite::params![PLAN,EXEC]).unwrap();
        }
        app
    }

    pub(crate) fn cleanup(app: AppCtx) {
        let dir = app.data_dir().unwrap();
        drop(app);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn session_query_reads_ordinary_parent_children_and_ancestors() {
        let app = fixture();
        let result = inspect(&app, "caller", Some("Ordinary parent")).unwrap();
        assert_eq!(result["session"]["sessionId"], "legacy");
        assert!(result["parent"].is_null());
        assert_eq!(result["ancestors"], json!([]));
        assert_eq!(result["children"].as_array().unwrap().len(), 2);
        assert_eq!(result["children"][0]["sessionId"], "legacy-child");
        assert_eq!(result["children"][1]["archived"], true);
        assert!(result["children"].as_array().unwrap().iter().all(|child|child["workflowIds"] == json!([])));
        let result = inspect(&app, "grandchild", None).unwrap();
        assert_eq!(result["parent"]["sessionId"], "legacy-child");
        assert_eq!(result["ancestors"][1]["sessionId"], "legacy");
        assert_eq!(inspect(&app,"caller",Some("archived-child")).unwrap()["parent"]["sessionId"], "legacy");
        cleanup(app);
    }

    #[test]
    fn session_query_returns_saved_properties_settings_and_masks_launch_secrets() {
        let app = fixture();
        {
            let conn = app.db().conn.lock().unwrap();
            conn.execute("UPDATE sessions SET shell='zsh',engine='chat',permission_mode='skip',collaboration_mode='plan',agent_preset_id='preset',agent_path='/bin/codex',hotkey='Cmd+1',agent_session_id='native-id',collapsed=1,fork_pending=1,worktree_path='/workspace/tree',worktree_base_ref='refs/heads/main',mark='*',sort_order=9,env_json=?2,init_cmd=?3,agent_args=?4 WHERE id=?1",
                rusqlite::params![PLAN,json!({"API_KEY":"fixture-secret","MODE":"dev"}).to_string(),"login fixture-password","--model launch-model -c model_reasoning_effort=low --token fixture-token"]).unwrap();
            conn.execute("INSERT INTO session_model_settings(session_id,model,effort,native_state) VALUES (?1,'saved-model','high','{}')", [PLAN]).unwrap();
            conn.execute("INSERT INTO chat_codex_settings(session_id,service_tier,personality) VALUES (?1,'fast','friendly')", [PLAN]).unwrap();
            conn.execute("INSERT INTO chat_claude_settings(session_id,chrome) VALUES ('legacy',1)", []).unwrap();
            conn.execute("INSERT INTO chat_auto_continue(session_id,continue_at,limit_type,rearms) VALUES (?1,999,'five_hour',1)", [PLAN]).unwrap();
            conn.execute("UPDATE sessions SET browser_url='https://user:fixture-password@example.invalid/page?token=fixture-token#private' WHERE id='archived-child'", []).unwrap();
        }
        let result = inspect(&app,"caller",Some("11111111")).unwrap();
        let s = &result["session"];
        for (key, expected) in [("projectId","p"),("groupId","g"),("kind","codex"),("shell","zsh"),("cwd","/workspace"),("engine","chat"),("permissionMode","skip"),("collaborationMode","plan"),("agentPresetId","preset"),("agentPath","/bin/codex"),("agentSessionId","native-id"),("hotkey","Cmd+1"),("worktreePath","/workspace/tree"),("worktreeBaseRef","refs/heads/main"),("mark","*")] {
            assert_eq!(s[key], expected, "{key}");
        }
        assert_eq!(s["collapsed"], true); assert_eq!(s["forkPending"], true);
        assert_eq!(s["sortOrder"], 9); assert_eq!(s["createdAt"], 123);
        assert_eq!(s["modelSettings"], json!({"model":"saved-model","effort":"high"}));
        assert_eq!(s["launchModelSettings"], json!({"model":"launch-model","effort":"low"}));
        assert_eq!(s["codexSettings"], json!({"serviceTier":"fast","personality":"friendly"}));
        assert_eq!(s["autoContinue"]["continueAt"], 999);
        assert_eq!(result["parent"]["modelSettings"], Value::Null);
        assert_eq!(inspect(&app,"caller",Some("legacy")).unwrap()["session"]["claudeSettings"]["chrome"], true);
        let environment: Value = serde_json::from_str(s["envJson"].as_str().unwrap()).unwrap();
        assert_eq!(environment, json!({"API_KEY":"[redacted]","MODE":"[redacted]"}));
        assert!(!result.to_string().contains("fixture-secret"));
        assert!(!result.to_string().contains("fixture-password"));
        assert!(!result.to_string().contains("fixture-token"));
        let browser = inspect(&app,"caller",Some("archived-child")).unwrap();
        assert_eq!(browser["session"]["browserUrl"], "https://example.invalid/page");
        assert_eq!(browser["session"]["redactedFields"], json!(["browserUrl"]));
        cleanup(app);
    }

    #[test]
    fn session_query_rejects_missing_ambiguous_targets_and_bounds_parent_cycles() {
        let app = fixture();
        assert!(inspect(&app,"missing",None).unwrap_err().contains("Calling session"));
        assert!(inspect(&app,"caller",Some("missing")).unwrap_err().contains("Target session"));
        assert!(inspect(&app,"caller",Some(" ")).is_err());
        assert!(inspect(&app,"caller",Some("child")).unwrap_err().contains("Ambiguous target"));
        app.db().conn.lock().unwrap().execute("UPDATE sessions SET parent_session_id='grandchild' WHERE id='legacy'", []).unwrap();
        assert_eq!(inspect(&app,"caller",Some("legacy")).unwrap()["ancestors"].as_array().unwrap().len(), 2);
        cleanup(app);
    }
}
