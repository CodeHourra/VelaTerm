//! Workflow discovery by session over the same read-only properties exposed by vself.

use super::{get, health, status, AppCtx, Request};
use crate::agent::session_query;
use serde_json::{json, Value};

pub(super) fn list_request(caller: &str, args: &[String]) -> Result<Request, String> {
    if args.len() > 1 || args.first().is_some_and(|arg| arg.starts_with('-') || arg.trim().is_empty()) {
        return Err("Usage: vflow list [session]".into());
    }
    Ok(Request { session_id:caller.into(), run_id:args.first().cloned().unwrap_or_default(),
        action:"list".into(), message_id:String::new(), text:String::new(), round:0 })
}

fn describe(app: &AppCtx, id: &str) -> Result<Value, String> {
    let mut result = health(app, id);
    result.as_object_mut().unwrap().extend(session_query::describe(app,id)?.as_object().unwrap().clone());
    Ok(result)
}

pub(super) fn list(app: &AppCtx, caller: &str, target: &str) -> Result<Value, String> {
    let relationships = session_query::inspect(app, caller, (!target.is_empty()).then_some(target))?;
    let id = relationships["session"]["sessionId"].as_str().unwrap();
    let runs = {
        let conn = app.db().conn.lock().unwrap();
        // A split planner belongs to every task; return each overall workflow once, with all its tasks.
        let mut query = conn.prepare("SELECT COALESCE(t.parent_id,r.id) FROM plan_execute_runs r LEFT JOIN plan_execute_tasks t ON t.run_id=r.id WHERE r.owner_id=?1 OR r.planner_id=?1 OR r.executor_id=?1 ORDER BY r.rowid").map_err(|e|e.to_string())?;
        let rows = query.query_map([id], |r|r.get::<_,String>(0)).map_err(|e|e.to_string())?
            .collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
        let mut runs = Vec::new();
        for run in rows { if !runs.contains(&run) { runs.push(run); } }
        runs
    };
    let workflows = runs.into_iter().map(|id| {
        let run = get(app, &id)?;
        let mut result = status(app, &run)?;
        result["prompt"] = json!(run.task);
        result["planner"] = describe(app, &run.planner_id)?;
        result["executor"] = run.executor_id.as_deref().map(|id|describe(app,id)).transpose()?.unwrap_or(Value::Null);
        if let Some(tasks) = result["tasks"].as_array_mut() {
            for task in tasks {
                if let Some(id) = task["run"]["executorId"].as_str().map(str::to_owned) {
                    task["executor"] = describe(app, &id)?;
                }
            }
        }
        Ok(result)
    }).collect::<Result<Vec<_>,String>>()?;
    let mut result = relationships;
    result["workflows"] = json!(workflows);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::session_query::tests::{fixture, cleanup, PLAN, EXEC};

    #[test]
    fn workflow_query_recovers_single_workflow_and_retains_action_authorization() {
        let app = fixture();
        let req = list_request(PLAN, &[]).unwrap();
        let result = super::super::action(&app, &req).unwrap();
        assert_eq!(result["workflows"][0]["run"]["id"], "run");
        assert_eq!(result["workflows"][0]["run"]["round"], 2);
        assert_eq!(result["workflows"][0]["run"]["summary"], "Execution report");
        assert_eq!(result["workflows"][0]["planner"]["sessionId"], PLAN);
        assert_eq!(result["workflows"][0]["executor"]["sessionId"], EXEC);
        assert_eq!(result["children"][0]["parentSessionId"], PLAN);
        for action in ["status", "stop", "dispatch", "accept", "block"] {
            let req = Request { session_id:"caller".into(), run_id:"run".into(), action:action.into(),
                round:2, message_id:String::new(), text:String::new() };
            assert!(super::super::action(&app,&req).unwrap_err().contains("does not belong"));
        }
        let lookup = list_request("caller", &[PLAN.into()]).unwrap();
        let result = super::super::action(&app,&lookup).unwrap();
        assert_eq!(result["workflows"][0]["run"]["state"], "reviewing");
        let conn = app.db().conn.lock().unwrap();
        assert_eq!(conn.query_row("SELECT count(*) FROM plan_execute_messages", [], |r|r.get::<_,i64>(0)).unwrap(), 0);
        assert_eq!(conn.query_row("SELECT count(*) FROM sessions", [], |r|r.get::<_,i64>(0)).unwrap(), 8);
        drop(conn);
        cleanup(app);
    }

    #[test]
    fn workflow_query_groups_split_tasks_preserves_rounds_and_returns_saved_attributes() {
        let app = fixture();
        {
            let conn = app.db().conn.lock().unwrap();
            conn.execute("UPDATE plan_execute_runs SET executor_id=NULL,config='{\"splitTasks\":true}' WHERE id='run'", []).unwrap();
            for (id, executor, round, state, position) in [("task-a",Some(EXEC),3,"reviewing",1),("task-b",None,0,"planning",0)] {
                conn.execute("INSERT INTO plan_execute_runs(id,owner_id,planner_id,executor_id,config,task,state,round) VALUES (?1,?2,?2,?3,'{}',?1,?4,?5)",
                    rusqlite::params![id,PLAN,executor,state,round]).unwrap();
                conn.execute("INSERT INTO plan_execute_tasks(parent_id,run_id,position,name,dispatch_id) VALUES ('run',?1,?2,?1,?1)", rusqlite::params![id,position]).unwrap();
            }
            conn.execute("UPDATE sessions SET permission_mode='skip',worktree_path='/workspace/executor' WHERE id=?1", [EXEC]).unwrap();
        }
        for target in [PLAN, "owner", EXEC] {
            let result = list(&app,"caller",target).unwrap();
            let workflows = result["workflows"].as_array().unwrap();
            assert_eq!(workflows.len(), 1);
            assert_eq!(workflows[0]["run"]["id"], "run");
            let tasks = workflows[0]["tasks"].as_array().unwrap();
            assert_eq!(tasks.len(), 2);
            assert_eq!(tasks[0]["run"]["id"], "task-b");
            assert!(tasks[0]["executor"].is_null());
            assert_eq!(tasks[1]["run"]["round"], 3);
            assert_eq!(tasks[1]["executor"]["permissionMode"], "skip");
            assert_eq!(tasks[1]["executor"]["worktreePath"], "/workspace/executor");
        }
        app.db().conn.lock().unwrap().execute("UPDATE sessions SET archived_at=456 WHERE id=?1", [PLAN]).unwrap();
        assert_eq!(list(&app,"caller",PLAN).unwrap()["workflows"][0]["planner"]["archivedAt"], 456);
        cleanup(app);
    }

    #[test]
    fn workflow_query_keeps_ordinary_children_distinct_and_validates_cli_targets() {
        let app = fixture();
        let result = list(&app,"caller","legacy").unwrap();
        assert_eq!(result["workflows"], json!([]));
        assert_eq!(result["children"].as_array().unwrap().len(), 2);
        assert_eq!(result["children"][0]["kind"], "terminal");
        assert!(list(&app,"caller","child").unwrap_err().contains("Ambiguous"));
        assert!(list(&app,"caller","missing").is_err());
        for args in [vec!["--round".into()],vec!["legacy".into(),"extra".into()],vec![" ".into()]] {
            assert!(list_request("caller",&args).is_err());
        }
        let req = list_request("caller", &["Ordinary parent".into()]).unwrap();
        assert_eq!(req.run_id, "Ordinary parent");
        assert!(req.text.is_empty());
        cleanup(app);
    }
}
