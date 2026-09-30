//! Full access for the account owner's own devices over the public relay.
//!
//! A public share normally admits visitors to AI conversations only, because velaterm.com authenticates
//! them and the host takes its word for it. Full access lifts that limit for a workspace (`machine`) share,
//! but never on the relay's word alone: the visitor must also prove possession of a device key that the host
//! owner approved on the host itself.
//!
//! The proof is a NaCl box sealed from the visitor device's long-term key to the host's E2EE key over
//! `PROOF_CONTEXT`, the visitor's ephemeral E2EE public key and the grant ID. Binding the ephemeral key ties
//! the proof to one E2EE session, so a relay that replays it cannot use it without that session's secret; a
//! relay that substitutes its own host key produces a proof the real host cannot open.
//!
//! Only the host owner edits the approved list (`vela-server devices approve`); the host process only reads
//! it and records unknown devices as pending, so a visitor can never approve itself.

use super::e2ee::ServerKeys;
use super::share_policy::ShareScope;
use crate::host::AppCtx;
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::Path;

/// Domain separator of the device proof; bump the suffix if the proof payload ever changes.
pub const PROOF_CONTEXT: &str = "vlx-full-access-v1";
/// Owner-edited switch and approved device keys. Written by the CLI only.
const CONFIG: &str = "vlx-full-access.json";
/// Devices that asked for full access and are waiting for the owner's decision. Written by the host.
const PENDING: &str = "vlx-full-access-pending.json";
/// Upper bound on remembered pending devices; the oldest entry is dropped first.
const MAX_PENDING: usize = 20;
/// Upper bound on a self-reported device name.
const MAX_NAME: usize = 120;

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FullAccessConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub devices: Vec<DeviceKey>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeviceKey {
    pub public_key: String,
    pub name: String,
    /// Unix seconds when the device was approved (trusted list) or last asked (pending list).
    pub at: u64,
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn read_json<T: for<'de> Deserialize<'de> + Default>(path: &Path) -> T {
    std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let pending = path.with_extension("new");
    let bytes = serde_json::to_vec_pretty(value).map_err(|_| "Cannot encode full access settings")?;
    super::write_owner_only(&pending, &bytes).map_err(|_| "Cannot save full access settings")?;
    std::fs::rename(pending, path).map_err(|_| "Cannot save full access settings".into())
}

pub fn load(dir: &Path) -> FullAccessConfig {
    read_json(&dir.join(CONFIG))
}

pub fn save(dir: &Path, config: &FullAccessConfig) -> Result<(), String> {
    write_json(&dir.join(CONFIG), config)
}

pub fn pending(dir: &Path) -> Vec<DeviceKey> {
    read_json(&dir.join(PENDING))
}

fn save_pending(dir: &Path, list: &[DeviceKey]) -> Result<(), String> {
    write_json(&dir.join(PENDING), &list)
}

/// Decodes a base64 X25519 public key, rejecting anything but 32 non-zero bytes.
fn key_bytes(public_key: &str) -> Option<[u8; 32]> {
    let bytes = B64.decode(public_key.trim()).ok()?;
    let arr = <[u8; 32]>::try_from(bytes.as_slice()).ok()?;
    (arr != [0u8; 32]).then_some(arr)
}

/// Short, human-comparable fingerprint of a device key: the first 8 bytes of its SHA-256, hex in groups of four.
pub fn fingerprint(public_key: &str) -> Option<String> {
    let bytes = key_bytes(public_key)?;
    let digest = Sha256::digest(bytes);
    let hex: String = digest[..8].iter().map(|b| format!("{b:02x}")).collect();
    Some(
        hex.as_bytes()
            .chunks(4)
            .map(|c| String::from_utf8_lossy(c).into_owned())
            .collect::<Vec<_>>()
            .join("-"),
    )
}

/// Normalizes a fingerprint typed by the owner: case-insensitive, separators optional.
fn same_fingerprint(public_key: &str, typed: &str) -> bool {
    let normalize = |s: &str| s.chars().filter(|c| c.is_ascii_hexdigit()).collect::<String>().to_lowercase();
    let typed = normalize(typed);
    !typed.is_empty() && fingerprint(public_key).is_some_and(|fp| normalize(&fp) == typed)
}

fn clean_name(name: &str) -> String {
    let name: String = name.chars().filter(|c| !c.is_control()).take(MAX_NAME).collect();
    let name = name.trim();
    if name.is_empty() { "Unnamed device".into() } else { name.to_string() }
}

fn proof_payload(client_pub: &str, grant_id: &str) -> String {
    format!("{PROOF_CONTEXT}\n{}\n{grant_id}", client_pub.trim())
}

/// Visitor side: seals the proof with this device's key to the host key reported by the share surface.
pub fn sign_proof(device: &ServerKeys, host_pub: &str, client_pub: &str, grant_id: &str) -> Result<String, String> {
    device
        .derive(host_pub)?
        .encrypt_text(&proof_payload(client_pub, grant_id))
        .ok_or_else(|| "Cannot sign device proof".into())
}

/// Host side: whether `proof` was sealed by the holder of `device_pub` for this session and grant.
pub fn verify_proof(host: &ServerKeys, device_pub: &str, proof: &str, client_pub: &str, grant_id: &str) -> bool {
    if key_bytes(device_pub).is_none() {
        return false;
    }
    let Ok(cipher) = host.derive(device_pub) else { return false };
    cipher
        .decrypt_text(proof)
        .is_some_and(|plain| plain == proof_payload(client_pub, grant_id).as_bytes())
}

/// Full access is only ever offered on a workspace share; project and conversation shares stay chat-only.
fn eligible(scope: &ShareScope) -> bool {
    scope.scope == "machine" && scope.target_id.is_none() && scope.push_authority.is_some()
}

fn trusted(config: &FullAccessConfig, device_pub: &str) -> bool {
    config.enabled && config.devices.iter().any(|d| d.public_key == device_pub.trim())
}

/// Decides whether a share connection is upgraded to full access. Every condition must hold: the owner
/// enabled full access, the share covers the workspace, the device key is approved, and the proof matches
/// this E2EE session and grant.
pub fn authorize(app: &AppCtx, scope: &ShareScope, host: &ServerKeys, device_pub: &str, proof: &str, client_pub: &str) -> bool {
    if !eligible(scope) {
        return false;
    }
    let Ok(dir) = app.data_dir() else { return false };
    let Some((grant_id, _)) = &scope.push_authority else { return false };
    trusted(&load(&dir), device_pub) && verify_proof(host, device_pub, proof, client_pub, grant_id)
}

/// Re-checked on every heartbeat of an upgraded connection, so disabling full access, revoking the device or
/// removing the share ends an open session within one interval.
pub fn still_authorized(app: &AppCtx, grant_id: &str, account_id: &str, device_pub: &str) -> bool {
    let Some(scope) = super::public_relay::share_scope_for(app, grant_id, account_id) else { return false };
    let Ok(dir) = app.data_dir() else { return false };
    eligible(&scope) && trusted(&load(&dir), device_pub)
}

/// Answers the visitor's pre-flight question "will this device get full access?". The answer only selects
/// which client to open; the WebSocket handshake enforces the decision independently. Unknown devices on an
/// eligible share are remembered as pending so the owner can approve them on the host.
pub fn probe(app: &AppCtx, scope: &ShareScope, device_pub: Option<&str>, device_name: Option<&str>) -> Value {
    let Ok(dir) = app.data_dir() else { return json!({"access":"chat"}) };
    let config = load(&dir);
    let Some(device_pub) = device_pub.filter(|k| key_bytes(k).is_some()) else {
        return json!({"access":"chat"});
    };
    if !config.enabled || !eligible(scope) {
        return json!({"access":"chat"});
    }
    if trusted(&config, device_pub) {
        return json!({"access":"full"});
    }
    let mut list = pending(&dir);
    list.retain(|d| d.public_key != device_pub.trim());
    list.push(DeviceKey {
        public_key: device_pub.trim().to_string(),
        name: clean_name(device_name.unwrap_or("")),
        at: now(),
    });
    let overflow = list.len().saturating_sub(MAX_PENDING);
    list.drain(..overflow);
    let _ = save_pending(&dir, &list);
    json!({"access":"chat","approval":"pending","fingerprint":fingerprint(device_pub)})
}

/// CLI: approves a pending device by fingerprint and returns it.
pub fn approve(dir: &Path, typed: &str) -> Result<DeviceKey, String> {
    let mut list = pending(dir);
    let index = list
        .iter()
        .position(|d| same_fingerprint(&d.public_key, typed))
        .ok_or("no pending device has this fingerprint. Open the device from the other computer first, then run `vela-server devices` to see it.")?;
    let mut device = list.remove(index);
    device.at = now();
    let mut config = load(dir);
    config.devices.retain(|d| d.public_key != device.public_key);
    config.devices.push(device.clone());
    save(dir, &config)?;
    save_pending(dir, &list)?;
    Ok(device)
}

/// CLI: removes an approved device by fingerprint and returns it.
pub fn revoke(dir: &Path, typed: &str) -> Result<DeviceKey, String> {
    let mut config = load(dir);
    let index = config
        .devices
        .iter()
        .position(|d| same_fingerprint(&d.public_key, typed))
        .ok_or("no approved device has this fingerprint")?;
    let device = config.devices.remove(index);
    save(dir, &config)?;
    Ok(device)
}

/// CLI: turns full access on or off without touching the approved list.
pub fn set_enabled(dir: &Path, enabled: bool) -> Result<(), String> {
    let mut config = load(dir);
    config.enabled = enabled;
    save(dir, &config)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("vlx-full-access-{name}-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// The proof opens only for the exact device, host, E2EE session key and grant it was sealed for.
    #[test]
    fn proof_binds_device_host_session_and_grant() {
        let host_dir = temp_dir("host");
        let device_dir = temp_dir("device");
        let other_dir = temp_dir("other");
        let host = ServerKeys::load_or_create(&host_dir).unwrap();
        let device = ServerKeys::load_or_create(&device_dir).unwrap();
        let other = ServerKeys::load_or_create(&other_dir).unwrap();
        let session = "c2Vzc2lvbi1rZXktYmFzZTY0LXBsYWNlaG9sZGVyLTAwMA==";
        let proof = sign_proof(&device, host.public_key_b64(), session, "grant-a").unwrap();
        assert!(verify_proof(&host, device.public_key_b64(), &proof, session, "grant-a"));
        assert!(!verify_proof(&host, device.public_key_b64(), &proof, session, "grant-b"));
        assert!(!verify_proof(&host, device.public_key_b64(), &proof, "b3RoZXItc2Vzc2lvbg==", "grant-a"));
        assert!(!verify_proof(&host, other.public_key_b64(), &proof, session, "grant-a"));
        // A proof sealed to a substituted host key cannot be opened by the real host.
        let forged = sign_proof(&device, other.public_key_b64(), session, "grant-a").unwrap();
        assert!(!verify_proof(&host, device.public_key_b64(), &forged, session, "grant-a"));
        for dir in [host_dir, device_dir, other_dir] {
            std::fs::remove_dir_all(dir).unwrap();
        }
    }

    /// A visitor can only ever land in the pending list; approval and revocation go through the owner.
    #[test]
    fn pending_approve_and_revoke_by_fingerprint() {
        let dir = temp_dir("approve");
        let device_dir = temp_dir("approve-device");
        let device = ServerKeys::load_or_create(&device_dir).unwrap();
        let key = device.public_key_b64().to_string();
        let fp = fingerprint(&key).unwrap();
        assert_eq!(fp.len(), 19);
        set_enabled(&dir, true).unwrap();
        assert!(approve(&dir, &fp).is_err());

        let mut list = vec![DeviceKey { public_key: key.clone(), name: "laptop".into(), at: 1 }];
        save_pending(&dir, &list).unwrap();
        let approved = approve(&dir, &fp.to_uppercase().replace('-', "")).unwrap();
        assert_eq!(approved.name, "laptop");
        assert!(trusted(&load(&dir), &key));
        assert!(pending(&dir).is_empty());

        set_enabled(&dir, false).unwrap();
        assert!(!trusted(&load(&dir), &key));
        set_enabled(&dir, true).unwrap();
        revoke(&dir, &fp).unwrap();
        assert!(!trusted(&load(&dir), &key));
        assert!(revoke(&dir, &fp).is_err());
        list.clear();
        std::fs::remove_dir_all(dir).unwrap();
        std::fs::remove_dir_all(device_dir).unwrap();
    }

    /// End to end on a real share-tunnel server: a visitor with an approved key and a valid proof is upgraded
    /// and reaches the regular command surface; the same visitor without approval stays in the share policy.
    #[test]
    fn share_connection_upgrades_only_for_approved_device() {
        use crate::host::{AppCtx, HeadlessHost};
        use futures_util::{SinkExt, StreamExt};
        use tokio_tungstenite::tungstenite::{client::IntoClientRequest, Message};

        let dir = temp_dir("e2e-host");
        let device_dir = temp_dir("e2e-device");
        let client_dir = temp_dir("e2e-client");
        let grant = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
        let config = json!({"origin":"https://velaterm.com","deviceId":"11111111-1111-1111-1111-111111111111",
            "token":"device-token","shares":{grant:{"scope":"machine","secret":"s","allowedAccounts":["acct-1"]}}});
        std::fs::write(dir.join("vlx-public-sharing.json"), config.to_string()).unwrap();
        let device = ServerKeys::load_or_create(&device_dir).unwrap();
        let db = crate::db::Db::open(&dir.join("test.db")).unwrap();
        let app = AppCtx::Headless(std::sync::Arc::new(HeadlessHost::new(dir.clone(), db)));
        let host_pub = ServerKeys::load_or_create(&dir).unwrap().public_key_b64().to_string();
        let port = loop {
            let port = 20000 + (uuid::Uuid::new_v4().as_u128() % 20000) as u16;
            if std::net::TcpListener::bind(("127.0.0.1", port)).is_ok() { break port; }
        };
        let web = super::super::WebServer::new();
        web.start(app.clone(), super::super::StartAuth::Tunnel { secret: "tunnel".into() }, Some(port),
            super::super::ServeMode::ShareTunnel).unwrap();

        // Connects as a share visitor, returns the authenticated frame and the reply to `system_stats`, which the
        // share policy refuses and the regular dispatch answers.
        let visit = |with_proof: bool| -> (Value, Value) {
            let client = ServerKeys::load_or_create(&client_dir).unwrap();
            let cipher = client.derive(&host_pub).unwrap();
            let mut hello = json!({"type":"e2ee_hello","publicKeyB64":client.public_key_b64()});
            if with_proof {
                hello["devicePublicKey"] = json!(device.public_key_b64());
                hello["deviceProof"] = json!(sign_proof(&device, &host_pub, client.public_key_b64(), grant).unwrap());
            }
            let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
            rt.block_on(async {
                let mut request = format!("ws://127.0.0.1:{port}/ws").into_client_request().unwrap();
                for (k, v) in [("x-vlx-tunnel-secret", "tunnel"), ("x-vlx-share", grant), ("x-vlx-account", "acct-1")] {
                    request.headers_mut().insert(k, v.parse().unwrap());
                }
                let (mut ws, _) = tokio_tungstenite::connect_async(request).await.unwrap();
                ws.send(Message::Text(hello.to_string())).await.unwrap();
                let Some(Ok(Message::Text(ready))) = ws.next().await else { panic!("no ready") };
                assert!(ready.contains("e2ee_ready"));
                ws.send(Message::Text(cipher.encrypt_text(r#"{"type":"e2ee_auth","deviceToken":""}"#).unwrap())).await.unwrap();
                let authenticated = loop {
                    if let Some(Ok(Message::Text(t))) = ws.next().await {
                        break serde_json::from_slice::<Value>(&cipher.decrypt_text(&t).unwrap()).unwrap();
                    }
                };
                let invoke = json!({"t":"invoke","id":7,"cmd":"system_stats","args":{}}).to_string();
                ws.send(Message::Text(cipher.encrypt_text(&invoke).unwrap())).await.unwrap();
                loop {
                    let Some(Ok(Message::Text(t))) = ws.next().await else { panic!("closed") };
                    let frame: Value = serde_json::from_slice(&cipher.decrypt_text(&t).unwrap()).unwrap();
                    if frame["t"] == "reply" && frame["id"] == 7 {
                        return (authenticated, frame);
                    }
                }
            })
        };

        // Full access off: the proof is ignored and the share policy answers.
        let (auth, reply) = visit(true);
        assert!(auth["access"].is_null());
        assert_eq!(reply["ok"], false);

        // On, but the device is not approved yet.
        set_enabled(&dir, true).unwrap();
        let (auth, _) = visit(true);
        assert!(auth["access"].is_null());

        // Approved: upgraded, and `system_stats` reaches the regular dispatch.
        save(&dir, &FullAccessConfig { enabled: true, devices: vec![DeviceKey {
            public_key: device.public_key_b64().into(), name: "laptop".into(), at: 0 }] }).unwrap();
        let (auth, reply) = visit(true);
        assert_eq!(auth["access"], "full");
        assert_eq!(reply["ok"], true);

        // Approved device, but no proof: stays within the share policy.
        let (auth, reply) = visit(false);
        assert!(auth["access"].is_null());
        assert_eq!(reply["ok"], false);

        web.stop();
        drop(app);
        for d in [dir, device_dir, client_dir] {
            std::fs::remove_dir_all(d).unwrap();
        }
    }

    #[test]
    fn only_workspace_shares_are_eligible() {
        let mut scope = ShareScope { scope: "machine".into(), target_id: None, push_authority: Some(("g".into(), "a".into())) };
        assert!(eligible(&scope));
        scope.scope = "project".into();
        scope.target_id = Some("p".into());
        assert!(!eligible(&scope));
        let unauthenticated = ShareScope { scope: "machine".into(), target_id: None, push_authority: None };
        assert!(!eligible(&unauthenticated));
    }
}
