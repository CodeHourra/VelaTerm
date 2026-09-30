import { useEffect, useState } from "react";
import { invoke } from "../ipc/transport";
import { remoteDevices, type RemoteDevice } from "./remoteApi";
import { SharingLink } from "./navigation";
import { remoteText as t } from "./remoteApi";
import "./remote-access.css";

/** How the desktop opened a device: full access, or conversations with the reason full access is unavailable. */
interface OpenResult {
  access?: string;
  approval?: string;
  fingerprint?: string;
  hostVersion?: string;
}

type FullAccessNotice = {kind: "pending"; command: string} | {kind: "version"; version: string};

export function RemoteDevices({onClose}: {onClose: () => void}) {
  const [devices,setDevices] = useState<RemoteDevice[]>([]);
  const [linked,setLinked] = useState(false);
  const [ready,setReady] = useState(false);
  const [error,setError] = useState(false);
  const [busy,setBusy] = useState<string>();
  const [notice,setNotice] = useState<FullAccessNotice>();
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const status = await invoke<{linked:boolean}>("public_account_status");
        const list = status.linked ? await remoteDevices() : [];
        if (!stopped) {setLinked(status.linked);setDevices(list);setError(false);}
      } catch {if (!stopped) {setDevices([]);setError(true);}}
      finally {if (!stopped) {setReady(true);timer=setTimeout(() => void refresh(),5000);}}
    };
    void refresh();
    return () => {stopped=true;clearTimeout(timer);};
  }, []);
  return <section className="remote-devices">
    {!ready && <p role="status">{t("Loading…")}</p>}
    {error && <p role="alert">{t("Service unavailable. Please try again.")}</p>}
    {notice?.kind === "pending" && <div className="remote-full-notice" role="status"><p>{t("remote.full_pending")}</p><code>{notice.command}</code></div>}
    {notice?.kind === "version" && <p className="remote-full-notice" role="status">{t("remote.full_version").replace("{version}", notice.version)}</p>}
    {ready && !linked && !error && <><p>{t("remote.login")}</p><SharingLink values={{publicAccount:"1",connect:null}} onClick={onClose}>{t("Sign in to VelaTerm")}</SharingLink></>}
    {ready && linked && !error && !devices.length && <p>{t("remote.no_clients")}</p>}
    {devices.map(d => <div className="remote-device" key={d.id}><div><strong>{d.name}</strong><small className="remote-device-status">{t(d.online ? "remote.online" : "remote.offline")}</small><small>{d.access.length ? d.access.map(scope => scope.scope === "machine" ? t("remote.workspace") : scope.name === scope.scope ? t(`remote.${scope.scope}`) : scope.name).join(" · ") : t("remote.empty")}</small></div>{d.online === true && d.sharing === true && <button disabled={!!busy} onClick={() => {
      setBusy(d.id);setError(false);setNotice(undefined);
      // The workspace grant lets the desktop ask for full access first; the host decides and the window falls
      // back to conversations when this device is not approved there.
      const fullGrantId = d.access.find(scope => scope.scope === "machine")?.id;
      void invoke<OpenResult | undefined>("open_account_remote_window", {deviceId:d.id, fullGrantId}).then(result => {
        if (result?.approval === "pending" && result.fingerprint) setNotice({kind:"pending", command:`vela-server devices approve ${result.fingerprint}`});
        else if (result?.hostVersion) setNotice({kind:"version", version:result.hostVersion});
        else onClose();
      }).catch(() => setError(true)).finally(() => setBusy(undefined));
    }}>{busy === d.id ? t("Loading…") : t("remote.view") + " →"}</button>}</div>)}
  </section>;
}
