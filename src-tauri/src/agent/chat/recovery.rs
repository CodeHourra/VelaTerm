//! Durable prompt bodies and evidence at the provider-write boundary. Reads never dispatch work.

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use crate::host::AppCtx;
use crate::models::SessionKind;
use super::engine::QueuedMessage;
use super::protocol::ChatImage;

pub const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS chat_recovery_meta (
 id INTEGER PRIMARY KEY CHECK(id=1), scope TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_recovery_items (
 session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
 id TEXT NOT NULL, payload TEXT NOT NULL, wire_text TEXT NOT NULL,
 phase TEXT NOT NULL DEFAULT 'prepared', owner TEXT NOT NULL, queue_order INTEGER NOT NULL DEFAULT 0,
 native_id TEXT, boundary TEXT, provider_id TEXT, matched_id TEXT,
 active INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
 PRIMARY KEY(session_id,id)
);
CREATE TABLE IF NOT EXISTS chat_recovery_state (
 session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
 interrupted_id TEXT, continuation_id TEXT
);";

fn clock() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        .map(|v| v.as_millis() as i64).unwrap_or(0)
}

pub(super) fn runtime_id() -> &'static str {
    static ID: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    ID.get_or_init(|| format!("{}:{}",std::process::id(),uuid::Uuid::new_v4()))
}

/// Called in the receipt transaction. Shell execution receipts have a different payload shape.
pub fn prepare(conn: &Connection, session: &str, id: &str, payload: &[u8]) -> Result<(), String> {
    // Internal engine peers may not be persisted sessions. Public sends always validate the session.
    if !conn.query_row("SELECT EXISTS(SELECT 1 FROM sessions WHERE id=?1)",[session],|r|r.get::<_,bool>(0)).map_err(|e|e.to_string())? { return Ok(()) }
    let Ok(value) = serde_json::from_slice::<Value>(payload) else { return Ok(()) };
    let Some(text) = value.get(0).and_then(Value::as_str) else { return Ok(()) };
    if !value.get(1).is_some_and(Value::is_array) { return Ok(()) }
    conn.execute("INSERT OR IGNORE INTO chat_recovery_items(session_id,id,payload,wire_text,created_at,owner) VALUES (?1,?2,?3,?4,?5,?6)",
        params![session,id,value.to_string(),text,clock(),runtime_id()]).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn queue(conn: &Connection, session: &str, item: &QueuedMessage, front: bool) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    prepare(&tx, session, &item.id, &serde_json::to_vec(&json!([item.text,item.images,"queue"])).map_err(|e| e.to_string())?)?;
    if !tx.query_row("SELECT EXISTS(SELECT 1 FROM chat_recovery_items WHERE session_id=?1 AND id=?2)",params![session,item.id],|r|r.get::<_,bool>(0)).map_err(|e|e.to_string())? { return tx.commit().map_err(|e|e.to_string()); }
    let order: i64 = tx.query_row(if front {
        "SELECT COALESCE(MIN(queue_order),0)-1 FROM chat_recovery_items WHERE session_id=?1 AND phase='queued'"
    } else {
        "SELECT COALESCE(MAX(queue_order),0)+1 FROM chat_recovery_items WHERE session_id=?1 AND phase='queued'"
    }, [session], |r| r.get(0)).map_err(|e| e.to_string())?;
    tx.execute("UPDATE chat_recovery_items SET phase='queued',wire_text=?3,queue_order=?4 WHERE session_id=?1 AND id=?2 AND phase IN ('prepared','rejected','queued')",
        params![session,item.id,item.text,order]).map_err(|e| e.to_string())?;
    super::submissions::finish(&tx, session, &item.id, &Ok("queued".into()))?;
    tx.commit().map_err(|e| e.to_string())
}

pub fn queued(conn: &Connection, session: &str) -> Result<Vec<QueuedMessage>, String> {
    let mut query = conn.prepare("SELECT id,wire_text,payload FROM chat_recovery_items WHERE session_id=?1 AND phase='queued' ORDER BY queue_order,created_at,id").map_err(|e| e.to_string())?;
    let values = query.query_map([session], |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?)))
        .map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
    values.into_iter().map(|(id,text,raw)| {
        let value: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        let images: Vec<ChatImage> = serde_json::from_value(value[1].clone()).map_err(|e| e.to_string())?;
        Ok(QueuedMessage { id, text, images })
    }).collect()
}

pub fn edit(conn: &Connection, session: &str, id: &str, text: &str) -> Result<(), String> {
    let raw: Option<String> = conn.query_row("SELECT payload FROM chat_recovery_items WHERE session_id=?1 AND id=?2 AND phase='queued'",params![session,id],|r|r.get(0))
        .optional().map_err(|e|e.to_string())?;
    let Some(raw) = raw else {
        if !conn.query_row("SELECT EXISTS(SELECT 1 FROM sessions WHERE id=?1)",[session],|r|r.get::<_,bool>(0)).map_err(|e|e.to_string())? { return Ok(()) }
        return Err("This message is no longer queued.".into());
    };
    let mut value: Value = serde_json::from_str(&raw).map_err(|e|e.to_string())?;
    if value[1].as_array().is_some_and(Vec::is_empty) && super::shell::parse_context(&value[0].as_str().unwrap_or("")).is_some() {
        return Err("Executed shell context cannot be edited.".into());
    }
    value[0] = json!(text);
    let payload = serde_json::to_vec(&value).map_err(|e|e.to_string())?;
    let tx = conn.unchecked_transaction().map_err(|e|e.to_string())?;
    tx.execute("UPDATE chat_recovery_items SET payload=?3,wire_text=?4 WHERE session_id=?1 AND id=?2 AND phase='queued'",params![session,id,value.to_string(),text]).map_err(|e|e.to_string())?;
    tx.execute("UPDATE chat_submissions SET fingerprint=?3 WHERE session_id=?1 AND id=?2 AND outcome=?4",
        params![session,id,format!("{:x}",Sha256::digest(payload)),serde_json::to_string(&Ok::<_,String>("queued")).unwrap()]).map_err(|e|e.to_string())?;
    tx.commit().map_err(|e|e.to_string())
}

pub fn cancel(conn: &Connection, session: &str, id: &str) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|e|e.to_string())?;
    let changed = tx.execute("UPDATE chat_recovery_items SET phase='cancelled',active=0 WHERE session_id=?1 AND id=?2 AND phase='queued'",params![session,id]).map_err(|e|e.to_string())?;
    if changed == 1 {
        tx.execute("UPDATE chat_submissions SET outcome=?3 WHERE session_id=?1 AND id=?2 AND outcome=?4",params![session,id,
            serde_json::to_string(&Err::<String,_>("The queued message was cancelled")).unwrap(),serde_json::to_string(&Ok::<_,String>("queued")).unwrap()]).map_err(|e|e.to_string())?;
    }
    tx.commit().map_err(|e|e.to_string())
}

/// The full observed prefix fences repeated text, compaction and branch changes. Absence is never proof.
fn users(kind: SessionKind, native: &str) -> Result<Vec<String>, String> {
    Ok(user_hashes(&super::history::read(kind,native)?))
}

fn user_hashes(events: &[super::history::ChatEvent]) -> Vec<String> {
    events.iter().filter(|e|e.kind=="user").map(|e| {
        let identity=super::history::recovery_identity(e);
        let value=if identity.is_some() { json!([e.text,e.timestamp,identity]) } else { json!([e.text,e.timestamp]) };
        format!("{:x}",Sha256::digest(serde_json::to_vec(&value).unwrap()))
    }).collect()
}

fn row_matches(kind: SessionKind, event: &super::history::ChatEvent, row: &super::engine::ChatRow) -> bool {
    let super::engine::ChatRow::User { id,text,at,.. }=row else { return false };
    event.text.as_deref()==Some(text.as_str()) && super::history::parsed_at(event.timestamp.as_deref())==*at
        && (kind!=SessionKind::Opencode || super::history::recovery_identity(event).is_some_and(|native|super::opencode_timeline::user_row_id(&native)==*id))
}

pub fn before_dispatch(app: &AppCtx, session: &str, id: &str, kind: SessionKind, native: Option<&str>, text: &str) -> Result<(), String> {
    let boundary = native.and_then(|n| users(kind,n).ok()).map(|v|json!(v).to_string());
    let conn = app.db().conn.lock().unwrap();
    let tx = conn.unchecked_transaction().map_err(|e|e.to_string())?;
    super::submissions::begin_dispatch(&tx,session,id)?;
    if !tx.query_row("SELECT EXISTS(SELECT 1 FROM chat_recovery_items WHERE session_id=?1 AND id=?2)",params![session,id],|r|r.get::<_,bool>(0)).map_err(|e|e.to_string())? { return tx.commit().map_err(|e|e.to_string()); }
    tx.execute("UPDATE chat_recovery_items SET active=0 WHERE session_id=?1 AND active=1",[session]).map_err(|e|e.to_string())?;
    tx.execute("UPDATE chat_recovery_items SET phase='dispatching',wire_text=?3,native_id=?4,boundary=?5,active=1 WHERE session_id=?1 AND id=?2",params![session,id,text,native,boundary]).map_err(|e|e.to_string())?;
    tx.execute("INSERT INTO chat_recovery_state(session_id) VALUES (?1) ON CONFLICT(session_id) DO UPDATE SET interrupted_id=NULL,continuation_id=CASE WHEN continuation_id=?2 THEN continuation_id ELSE NULL END",params![session,id]).map_err(|e|e.to_string())?;
    tx.commit().map_err(|e|e.to_string())
}

pub fn provider_id(app: &AppCtx, session: &str, id: &str, provider_id: &str) -> Result<(), String> {
    app.db().conn.lock().unwrap().execute("UPDATE chat_recovery_items SET provider_id=?3 WHERE session_id=?1 AND id=?2",params![session,id,provider_id]).map_err(|e|e.to_string())?;
    Ok(())
}

pub fn dispatch_pending(conn: &Connection, session: &str, id: &str) -> bool {
    conn.query_row("SELECT phase='dispatching' FROM chat_recovery_items WHERE session_id=?1 AND id=?2",params![session,id],|r|r.get(0)).unwrap_or(false)
}

pub fn dispatch_confirmed(conn: &Connection, session: &str, id: &str) -> bool {
    conn.query_row("SELECT phase='sent' FROM chat_recovery_items WHERE session_id=?1 AND id=?2",params![session,id],|r|r.get(0)).unwrap_or(false)
}

pub fn not_dispatched(conn: &Connection, session: &str, id: &str) -> bool {
    conn.query_row("SELECT phase='prepared' FROM chat_recovery_items WHERE session_id=?1 AND id=?2",params![session,id],|r|r.get(0)).unwrap_or(false)
}

pub fn still_queued(conn: &Connection, session: &str, id: &str) -> bool {
    conn.query_row("SELECT phase='queued' FROM chat_recovery_items WHERE session_id=?1 AND id=?2",params![session,id],|r|r.get(0)).unwrap_or(false)
}

pub fn background_work(app: &AppCtx, session: &str) {
    if app.db().conn.lock().unwrap().execute("UPDATE chat_recovery_items SET active=1 WHERE session_id=?1 AND id=(SELECT id FROM chat_recovery_items WHERE session_id=?1 AND phase IN ('sent','dispatching') ORDER BY created_at DESC,id DESC LIMIT 1)",[session]).is_err() {
        crate::diagnostic_warn!("chat recovery: failed to record background work");
    }
}

pub fn end_turn(app: &AppCtx, session: &str) {
    let conn = app.db().conn.lock().unwrap();
    let result = conn.execute("UPDATE chat_recovery_items SET active=0 WHERE session_id=?1 AND phase IN ('sent','dispatching')",[session]);
    let _ = conn.execute("UPDATE chat_recovery_state SET interrupted_id=NULL WHERE session_id=?1",[session]);
    if result.is_err() { crate::diagnostic_warn!("chat recovery: failed to persist turn completion"); }
}

/// Preserve an offer once per interruption; repeated reads cannot rotate its operation identity.
pub fn interrupt(app: &AppCtx, session: &str) -> Result<(), String> {
    let conn = app.db().conn.lock().unwrap();
    conn.execute("INSERT INTO chat_recovery_state(session_id,interrupted_id) SELECT ?1,?2 WHERE EXISTS (SELECT 1 FROM chat_recovery_items WHERE session_id=?1 AND active=1) ON CONFLICT(session_id) DO UPDATE SET interrupted_id=COALESCE(interrupted_id,excluded.interrupted_id)",
        params![session,format!("msg-{}",uuid::Uuid::new_v4())]).map_err(|e|e.to_string())?;
    Ok(())
}

#[derive(Default, serde::Serialize)]
#[serde(rename_all="camelCase")]
pub struct Recovery {
    pub scope: String,
    pub items: Vec<Value>,
    pub confirmed_ids: Vec<String>,
    pub interrupted_id: Option<String>,
    pub queue_paused: bool,
    pub writer_blocked: bool,
}

pub fn read(app: &AppCtx, session: &str) -> Result<Recovery, String> {
    let alive = app.chat().is_alive(session);
    let writer_blocked = !alive && super::ownership::idle_guard(app,session).is_err();
    if !alive && !writer_blocked { interrupt(app,session)?; }
    let (kind,native,records) = {
        let conn = app.db().conn.lock().unwrap();
        let s = crate::db::repo::get_session(&conn,session)?.ok_or("Session not found")?;
        let mut q = conn.prepare("SELECT id,payload,wire_text,phase,native_id,boundary,provider_id,matched_id,owner FROM chat_recovery_items WHERE session_id=?1 AND 1=1 ORDER BY created_at,id").map_err(|e|e.to_string())?;
        let records = q.query_map([session],|r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,Option<String>>(4)?,r.get::<_,Option<String>>(5)?,r.get::<_,Option<String>>(6)?,r.get::<_,Option<String>>(7)?,r.get::<_,String>(8)?)))
            .map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
        (s.kind,s.agent_session_id,records)
    };
    let history = native.as_deref().and_then(|n|super::history::read(kind,n).ok());
    let prefix = history.as_ref().map(|events|user_hashes(events));
    let mut result = Recovery { writer_blocked, ..Recovery::default() };
    let conn = app.db().conn.lock().unwrap();
    conn.execute("INSERT OR IGNORE INTO chat_recovery_meta(id,scope) VALUES (1,?1)",[uuid::Uuid::new_v4().to_string()]).map_err(|e|e.to_string())?;
    result.scope=conn.query_row("SELECT scope FROM chat_recovery_meta WHERE id=1",[],|r|r.get(0)).map_err(|e|e.to_string())?;
    for (id,raw,text,phase,recorded_native,boundary,provider_id,matched,owner) in &records {
        let expected_prefix = native.as_ref().map(|n|format!("{n}:"));
        let matched_parts = matched.as_deref().zip(expected_prefix.as_deref()).and_then(|(m,n)|m.strip_prefix(n)).and_then(|m|m.split_once(':'));
        let mut verified = matched_parts.is_some_and(|(index,hash)|index.parse::<usize>().ok().and_then(|i|prefix.as_ref().and_then(|p|p.get(i))).is_some_and(|v|v==hash));
        let value: Value = serde_json::from_str(raw).map_err(|e|e.to_string())?;
        let mut status = match phase.as_str() { "queued" => "queued", "cancelled" | "settled" | "sent" => "sent", "rejected" => "failed", _ if matched.is_some() => "sent", _ => "unknown" };
        if !alive && !writer_blocked && phase == "prepared" && owner != runtime_id() {
            // A different live host may still hold this prepared operation. Only a dead host proves that
            // its pre-write operation cannot later reach the wire.
            let pid = owner.split(':').next().and_then(|v|v.parse::<u32>().ok());
            if pid.is_some_and(|p|!super::ownership::process_may_exist(p)) && conn.query_row("SELECT outcome IS NULL FROM chat_submissions WHERE session_id=?1 AND id=?2",params![session,id],|r|r.get::<_,bool>(0)).unwrap_or(false) {
                super::submissions::finish_rejected(&conn,session,id,"The message was not dispatched before the application stopped")?;
                status="failed";
            }
        }
        // Only a unique new text message after an identical observed prefix can narrow uncertainty.
        let comparable = value[1].as_array().is_some_and(Vec::is_empty) && !text.starts_with('/') && !text.is_empty();
        if (matched.is_none() || matched_parts.is_none()) && recorded_native.as_ref().is_some_and(|n|Some(n)==native.as_ref()) && !matches!(phase.as_str(),"queued"|"prepared"|"rejected"|"cancelled"|"settled") {
            let boundary: Option<Vec<String>> = boundary.as_deref().and_then(|v|serde_json::from_str(v).ok());
            let boundary_ok = boundary.as_ref().zip(prefix.as_ref()).is_some_and(|(b,p)|p.starts_with(b));
            let candidates: Vec<_> = history.iter().flatten().filter(|e|e.kind=="user").enumerate()
                .filter(|(index,e)| {
                    let exact = provider_id.as_ref().is_some_and(|p|super::history::recovery_identity(e).as_ref()==Some(p));
                    if provider_id.is_some() { exact } else { comparable && boundary_ok && *index >= boundary.as_ref().unwrap().len() && e.text.as_deref()==Some(text.as_str()) }
                }).collect();
            let competing = records.iter().filter(|r|r.0!=*id && r.7.is_none() && r.2==*text && r.4==*recorded_native && !matches!(r.3.as_str(),"queued"|"prepared"|"rejected"|"cancelled"|"settled")).count();
            if candidates.len()==1 && (provider_id.is_some() || competing==0) {
                let key = format!("{}:{}:{}",native.as_deref().unwrap(),candidates[0].0,prefix.as_ref().and_then(|p|p.get(candidates[0].0)).ok_or("Cannot verify the native message boundary")?);
                let claimed: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM chat_recovery_items WHERE session_id=?1 AND matched_id=?2 AND id!=?3)",params![session,key,id],|r|r.get(0)).map_err(|e|e.to_string())?;
                if !claimed || matched.as_ref()==Some(&key) {
                    let tx = conn.unchecked_transaction().map_err(|e|e.to_string())?;
                    tx.execute("UPDATE chat_recovery_items SET matched_id=?3 WHERE session_id=?1 AND id=?2",params![session,id,key]).map_err(|e|e.to_string())?;
                    super::submissions::finish_dispatch(&tx,session,id,"sent")?;
                    tx.commit().map_err(|e|e.to_string())?;
                    status="sent";
                    verified=true;
                }
            }
        }
        if status=="queued" { result.queue_paused |= !alive && !writer_blocked; }
        let terminal = matches!(phase.as_str(),"cancelled"|"settled");
        if verified || terminal || status=="queued" { result.confirmed_ids.push(id.clone()); }
        if !verified && !terminal && status!="queued" && (!alive || owner!=runtime_id() || matches!(phase.as_str(),"dispatching"|"rejected"|"sent")) {
            let images: Vec<_> = value[1].as_array().into_iter().flatten().enumerate().map(|(index,image)|json!({"mimeType":image["mimeType"],"attachmentId":format!("saved:{id}:{index}")})).collect();
            result.items.push(json!({"id":id,"text":value[0],"images":images,"behavior":value[2],"status":status}));
        }
    }
    result.interrupted_id = conn.query_row("SELECT interrupted_id FROM chat_recovery_state WHERE session_id=?1",[session],|r|r.get(0)).optional().map_err(|e|e.to_string())?.flatten();
    Ok(result)
}

/// Merge only verified native messages. Unmatched sent requests remain separately readable.
pub fn restore_rows(app: &AppCtx, session: &str, rows: &mut [super::engine::ChatRow]) -> Result<(), String> {
    let conn = app.db().conn.lock().unwrap();
    let native: Option<String> = conn.query_row("SELECT agent_session_id FROM sessions WHERE id=?1",[session],|r|r.get(0)).map_err(|e|e.to_string())?;
    let Some(native) = native else { return Ok(()) };
    let mut query = conn.prepare("SELECT id,payload,matched_id FROM chat_recovery_items WHERE session_id=?1 AND matched_id IS NOT NULL AND native_id=?2").map_err(|e|e.to_string())?;
    let values = query.query_map(params![session,native],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?))).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
    let kind=crate::db::repo::get_session_kind(&conn,session)?.ok_or("Session not found")?;
    let history=super::history::read(kind,&native).unwrap_or_default();
    let observed=user_hashes(&history);
    let native_users: Vec<_>=history.iter().filter(|e|e.kind=="user").collect();
    let prefix = format!("{native}:");
    for (id,raw,matched) in values {
        let Some((index,hash)) = matched.strip_prefix(&prefix).and_then(|v|v.split_once(':')) else { continue };
        let Some(index)=index.parse::<usize>().ok().filter(|i|observed.get(*i).is_some_and(|v|v==hash)) else { continue };
        let row=rows.iter_mut().filter(|r|matches!(r,super::engine::ChatRow::User{..})).nth(index);
        let Some(row)=row.filter(|row|native_users.get(index).is_some_and(|event|row_matches(kind,event,row))) else { continue };
        if let super::engine::ChatRow::User { id: row_id,text,images,.. } = row {
            let value: Value = serde_json::from_str(&raw).map_err(|e|e.to_string())?;
            *row_id=id; *text=value[0].as_str().unwrap_or(text).to_string();
            *images=serde_json::from_value(value[1].clone()).map_err(|e|e.to_string())?;
        }
    }
    Ok(())
}

/// Snapshot references stay session-scoped even when no provider process exists after restart.
pub fn attachment(app: &AppCtx, session: &str, reference: &str) -> Result<ChatImage, String> {
    let Some((_,rest)) = reference.split_once(':') else { return Err("Invalid attachment reference".into()) };
    let Some((id,index)) = rest.rsplit_once(':') else { return Err("Invalid attachment reference".into()) };
    let index: usize = index.parse().map_err(|_|"Invalid attachment reference")?;
    let raw: String = app.db().conn.lock().unwrap().query_row("SELECT payload FROM chat_recovery_items WHERE session_id=?1 AND id=?2",params![session,id],|r|r.get(0)).map_err(|_|"This saved attachment is unavailable")?;
    let value: Value = serde_json::from_str(&raw).map_err(|e|e.to_string())?;
    value[1].get(index).cloned().ok_or("This saved attachment is unavailable".into()).and_then(|v|serde_json::from_value(v).map_err(|e|e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::submissions::{self, Claim};

    fn fixture() -> AppCtx {
        let dir = std::env::temp_dir().join(format!("vlx-recovery-{}",uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let db = crate::db::Db::open(&dir.join("test.db")).unwrap();
        db.conn.lock().unwrap().execute_batch("INSERT INTO projects(id,name,root_path,created_at) VALUES ('p','Recovery','/tmp',0); INSERT INTO sessions(id,project_id,name,kind,engine,created_at) VALUES ('s','p','Recovery','claude','chat',0);").unwrap();
        AppCtx::Headless(std::sync::Arc::new(crate::host::HeadlessHost::new(dir,db)))
    }

    #[test]
    fn queue_body_images_order_edit_and_cancellation_survive_database_reopen() {
        let app = fixture();
        let path = app.data_dir().unwrap().join("test.db");
        let images = vec![ChatImage { mime_type:"image/png".into(), data:"AQID".into() }];
        let mut ids = Vec::new();
        for (text,behavior,front) in [("first","queue",false),("second","queue",false),("instead","interrupt",true)] {
            let id = format!("msg-{}",uuid::Uuid::new_v4());
            let payload=serde_json::to_vec(&json!([text,images,behavior])).unwrap();
            let conn=app.db().conn.lock().unwrap();
            assert!(matches!(submissions::claim(&conn,"s",&id,&payload).unwrap(),Claim::New));
            queue(&conn,"s",&QueuedMessage { id:id.clone(),text:text.into(),images:images.clone() },front).unwrap();
            ids.push(id);
        }
        { let conn=app.db().conn.lock().unwrap(); edit(&conn,"s",&ids[1],"edited").unwrap(); cancel(&conn,"s",&ids[0]).unwrap(); }
        drop(app);
        let db=crate::db::Db::open(&path).unwrap();
        let conn=db.conn.lock().unwrap();
        let items=queued(&conn,"s").unwrap();
        assert_eq!(items.iter().map(|i|i.text.as_str()).collect::<Vec<_>>(),vec!["instead","edited"]);
        assert!(items.iter().all(|i|i.images[0].data=="AQID"));
        let edited=serde_json::to_vec(&json!(["edited",images,"queue"])).unwrap();
        assert!(matches!(submissions::claim(&conn,"s",&ids[1],&edited).unwrap(),Claim::Complete(Ok(v)) if v=="queued"));
        assert!(matches!(submissions::claim_retry(&conn,"s",&ids[0],&serde_json::to_vec(&json!(["first",images,"queue"])).unwrap()).unwrap(),Claim::Complete(Err(_))));
    }

    #[test]
    fn missing_history_never_resends_unknown_and_interrupt_offer_is_stable() {
        let app=fixture();
        let id=format!("msg-{}",uuid::Uuid::new_v4());
        let payload=serde_json::to_vec(&json!(["uncertain",[],"steer"])).unwrap();
        submissions::claim(&app.db().conn.lock().unwrap(),"s",&id,&payload).unwrap();
        before_dispatch(&app,"s",&id,SessionKind::Claude,Some("missing-native"),"uncertain").unwrap();
        let first=read(&app,"s").unwrap();
        let second=read(&app,"s").unwrap();
        assert_eq!(first.items[0]["status"],"unknown");
        assert_eq!(first.interrupted_id,second.interrupted_id);
        assert!(first.interrupted_id.is_some());
        assert!(submissions::claim_retry(&app.db().conn.lock().unwrap(),"s",&id,&payload).is_err());
        assert!(first.confirmed_ids.is_empty());
    }

    #[test]
    fn a_new_dispatch_invalidates_the_previous_continuation_offer() {
        let app=fixture();
        crate::db::repo::set_agent_session_id(&app.db().conn.lock().unwrap(),"s","missing-native",SessionKind::Claude).unwrap();
        let previous=format!("msg-{}",uuid::Uuid::new_v4());
        let payload=serde_json::to_vec(&json!(["continue",[],"queue"])).unwrap();
        submissions::claim(&app.db().conn.lock().unwrap(),"s",&previous,&payload).unwrap();
        app.db().conn.lock().unwrap().execute("INSERT INTO chat_recovery_state(session_id,interrupted_id,continuation_id) VALUES ('s',?1,?1)",[&previous]).unwrap();
        before_dispatch(&app,"s",&previous,SessionKind::Claude,Some("missing-native"),"continue").unwrap();
        let saved: Option<String>=app.db().conn.lock().unwrap().query_row("SELECT continuation_id FROM chat_recovery_state WHERE session_id='s'",[],|r|r.get(0)).unwrap();
        assert_eq!(saved.as_deref(),Some(previous.as_str()));
        let next=format!("msg-{}",uuid::Uuid::new_v4());
        let payload=serde_json::to_vec(&json!(["new task",[],"queue"])).unwrap();
        submissions::claim(&app.db().conn.lock().unwrap(),"s",&next,&payload).unwrap();
        before_dispatch(&app,"s",&next,SessionKind::Claude,Some("missing-native"),"new task").unwrap();
        assert!(crate::command_core::chat_recovery_resume(&app,"s",Some(&previous)).unwrap_err().contains("no longer current"));
        assert!(!app.chat().is_alive("s"));
    }

    #[test]
    fn dead_host_prewrite_is_retryable_but_a_live_host_is_not() {
        let app=fixture();
        for (owner,expected) in [(runtime_id(),"unknown"),("4294967295:dead",if cfg!(any(unix,windows)) { "failed" } else { "unknown" })] {
            let id=format!("msg-{}",uuid::Uuid::new_v4());
            let payload=serde_json::to_vec(&json!([owner,[],"queue"])).unwrap();
            let conn=app.db().conn.lock().unwrap();
            submissions::claim(&conn,"s",&id,&payload).unwrap();
            conn.execute("UPDATE chat_recovery_items SET owner=?3 WHERE session_id=?1 AND id=?2",params!["s",id,owner]).unwrap();
            drop(conn);
            let result=read(&app,"s").unwrap();
            assert_eq!(result.items.iter().find(|i|i["id"]==id).unwrap()["status"],expected);
            if expected=="failed" { assert!(matches!(submissions::claim_retry(&app.db().conn.lock().unwrap(),"s",&id,&payload).unwrap(),Claim::New)); }
        }
    }

    #[test]
    fn sent_receipt_retains_unmatched_body_and_reopened_attachment() {
        let app=fixture();
        let id=format!("msg-{}",uuid::Uuid::new_v4());
        let payload=serde_json::to_vec(&json!(["photo",[{"mimeType":"image/png","data":"AQID"}],"queue"])).unwrap();
        submissions::claim(&app.db().conn.lock().unwrap(),"s",&id,&payload).unwrap();
        before_dispatch(&app,"s",&id,SessionKind::Claude,None,"photo").unwrap();
        submissions::finish_dispatch(&app.db().conn.lock().unwrap(),"s",&id,"sent").unwrap();
        let result=read(&app,"s").unwrap();
        assert_eq!(result.items[0]["status"],"sent");
        assert_eq!(result.items[0]["text"],"photo");
        assert_eq!(attachment(&app,"s",&format!("row:{id}:0")).unwrap().data,"AQID");
        assert!(attachment(&app,"other",&format!("row:{id}:0")).is_err());
    }

    #[test]
    fn native_evidence_resolves_receipt_but_duplicates_and_branch_changes_stay_separate() {
        struct Log(std::path::PathBuf);
        impl Drop for Log { fn drop(&mut self) { let _=std::fs::remove_dir_all(&self.0); } }
        let app=fixture();
        let native=uuid::Uuid::new_v4().to_string();
        let dir=crate::agent::resume::claude_home().unwrap().join("projects").join(format!("vlx-recovery-test-{native}"));
        std::fs::create_dir_all(&dir).unwrap(); let _cleanup=Log(dir.clone());
        let path=dir.join(format!("{native}.jsonl"));
        let frame=|id: &str,parent: Option<&str>,text: &str| json!({"type":"user","uuid":id,"parentUuid":parent,"timestamp":"2026-10-05T01:00:00.000Z","message":{"role":"user","content":text}}).to_string()+"\n";
        let earlier=frame("earlier",None,"earlier");
        std::fs::write(&path,&earlier).unwrap();
        crate::db::repo::set_agent_session_id(&app.db().conn.lock().unwrap(),"s",&native,SessionKind::Claude).unwrap();
        let id=format!("msg-{}",uuid::Uuid::new_v4());
        let payload=serde_json::to_vec(&json!(["unique",[],"queue"])).unwrap();
        submissions::claim(&app.db().conn.lock().unwrap(),"s",&id,&payload).unwrap();
        before_dispatch(&app,"s",&id,SessionKind::Claude,Some(&native),"unique").unwrap();
        std::fs::write(&path,earlier.clone()+&frame("unique",Some("earlier"),"unique")).unwrap();
        assert!(read(&app,"s").unwrap().confirmed_ids.contains(&id));
        assert!(matches!(submissions::claim_retry(&app.db().conn.lock().unwrap(),"s",&id,&payload).unwrap(),Claim::Complete(Ok(v)) if v=="sent"));
        let mut rows=super::super::history::replay(SessionKind::Claude,&native).unwrap();
        restore_rows(&app,"s",&mut rows).unwrap();
        assert!(rows.iter().any(|r|matches!(r,super::super::engine::ChatRow::User{id:row_id,..} if row_id==&id)));
        let duplicate=serde_json::to_vec(&json!(["same",[],"queue"])).unwrap();
        let mut duplicates=Vec::new();
        for _ in 0..2 {
            let id=format!("msg-{}",uuid::Uuid::new_v4());
            submissions::claim(&app.db().conn.lock().unwrap(),"s",&id,&duplicate).unwrap();
            before_dispatch(&app,"s",&id,SessionKind::Claude,Some(&native),"same").unwrap();
            duplicates.push(id);
        }
        let recorded=std::fs::read_to_string(&path).unwrap()+&frame("same",Some("unique"),"same");
        std::fs::write(&path,recorded).unwrap();
        let result=read(&app,"s").unwrap();
        assert!(duplicates.iter().all(|id|result.items.iter().any(|i|i["id"]==*id && i["status"]=="unknown")));
        std::fs::write(&path,earlier+&frame("different",Some("earlier"),"different")).unwrap();
        let mut changed=super::super::history::replay(SessionKind::Claude,&native).unwrap();
        restore_rows(&app,"s",&mut changed).unwrap();
        assert!(!changed.iter().any(|r|matches!(r,super::super::engine::ChatRow::User{id:row_id,..} if row_id==&id)));
    }

    #[test]
    fn opencode_identity_fences_identical_bodies_and_stale_replay_rows() {
        let messages: Vec<_>=["native-a","native-b"].into_iter().map(|id|crate::agent::opencode_store::OpencodeMessage {
            info:json!({"id":id,"role":"user","time":{"created":1000}}),
            parts:vec![json!({"id":format!("part-{id}"),"type":"text","text":"same"})],
        }).collect();
        let history=super::super::history::opencode_history(&messages);
        assert_eq!(history.len(),2);
        assert_eq!(super::super::history::recovery_identity(&history[0]).as_deref(),Some("native-a"));
        assert_eq!(super::super::history::recovery_identity(&history[1]).as_deref(),Some("native-b"));
        assert_ne!(user_hashes(&history)[0],user_hashes(&history)[1]);
        let rows=super::super::opencode_timeline::rows(&messages,&|_|None);
        assert!(row_matches(SessionKind::Opencode,&history[0],&rows[0]));
        assert!(!row_matches(SessionKind::Opencode,&history[1],&rows[0]));
        assert!(row_matches(SessionKind::Opencode,&history[1],&rows[1]));
    }

    #[cfg(unix)]
    #[test]
    fn inherited_lease_blocks_a_second_writer_until_the_owned_child_is_drained() {
        use std::os::unix::process::CommandExt;
        let app=fixture();
        let mut owner=super::super::ownership::Owner::acquire(&app,"s",None).unwrap();
        let mut command=std::process::Command::new("sleep"); command.arg("30").process_group(0);
        owner.inherit(&mut command);
        let mut child=command.spawn().unwrap();
        owner.launched(&app,"s",child.id()).unwrap();
        let native=format!("claude:{}",uuid::Uuid::new_v4());
        owner.native(&app,&native).unwrap();
        drop(owner);
        assert!(super::super::ownership::Owner::acquire(&app,"s",None).is_err());
        let other=fixture();
        assert!(super::super::ownership::Owner::acquire(&other,"s",Some(native.clone())).is_err());
        crate::host::kill_process_tree(&mut child); child.wait().unwrap();
        let next=super::super::ownership::Owner::acquire(&app,"s",None).unwrap();
        next.retire(&app,"s");
        let reopened=super::super::ownership::Owner::acquire(&other,"s",Some(native)).unwrap();
        reopened.retire(&other,"s");
    }

    #[cfg(unix)]
    #[test]
    fn native_ownership_survives_a_reaped_group_leader() {
        use std::io::{BufRead,Write};
        use std::os::unix::process::CommandExt;
        struct Group(u32);
        impl Drop for Group { fn drop(&mut self) { unsafe { libc::kill(-(self.0 as i32),libc::SIGKILL); } } }
        let app=fixture();
        let mut owner=super::super::ownership::Owner::acquire(&app,"s",None).unwrap();
        let mut command=std::process::Command::new("sh");
        command.args(["-c","sleep 30 & echo ready; read finish"]).process_group(0)
            .stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped());
        owner.inherit(&mut command);
        let mut child=command.spawn().unwrap(); let _cleanup=Group(child.id());
        owner.launched(&app,"s",child.id()).unwrap();
        let mut ready=String::new(); std::io::BufReader::new(child.stdout.take().unwrap()).read_line(&mut ready).unwrap();
        assert_eq!(ready.trim(),"ready");
        let native=format!("claude:{}",uuid::Uuid::new_v4());
        owner.native(&app,&native).unwrap();
        child.stdin.take().unwrap().write_all(b"finish\n").unwrap(); child.wait().unwrap();
        owner.retire(&app,"s"); drop(owner);
        let other=fixture();
        assert!(super::super::ownership::Owner::acquire(&other,"s",Some(native.clone())).is_err());
        crate::db::repo::set_agent_session_id(&other.db().conn.lock().unwrap(),"s",native.strip_prefix("claude:").unwrap(),SessionKind::Claude).unwrap();
        assert!(super::super::ownership::idle_guard(&other,"s").is_err());
    }

    #[test]
    fn exclusive_writer_and_old_owner_retirement_are_fenced() {
        let app=fixture();
        let owner=super::super::ownership::Owner::acquire(&app,"s",None).unwrap();
        assert!(super::super::ownership::Owner::acquire(&app,"s",None).is_err());
        let conn=app.db().conn.lock().unwrap();
        conn.execute("UPDATE chat_process_owners SET token='replacement' WHERE session_id='s'",[]).unwrap();
        drop(conn);
        owner.retire(&app,"s");
        assert_eq!(app.db().conn.lock().unwrap().query_row("SELECT token FROM chat_process_owners WHERE session_id='s'",[],|r|r.get::<_,String>(0)).unwrap(),"replacement");
    }
}
