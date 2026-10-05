//! Display the executing server identity; the browser's operating system never supplies filesystem facts.

import { useEffect, useState } from "react";
import Icons from "../components/Icons";
import { useT } from "../i18n";
import { env } from "../platform";
import { serverFs, type ServerFs } from "./serverPath";

export function ExecutionContext({ fs }: { fs?: ServerFs | null }) {
  const t = useT();
  const [resolved, setResolved] = useState<ServerFs | null>(fs ?? null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (fs !== undefined) return;
    let alive = true;
    serverFs().then(value => { if (alive) setResolved(value); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [fs]);
  const info = fs === undefined ? resolved : fs;
  const os = info?.os === "macos" ? "macOS" : info?.os === "windows" ? "Windows" : info?.os === "linux" ? "Linux" : info?.os;
  return (
    <div className={"fp-context" + (failed ? " error" : "")} aria-live="polite">
      <Icons.drive size={17} />
      {info ? <span>{env.isTauri || env.isElectron ? t("location.local") : t("location.server")} · {info.hostName || t("location.host")} · {os || t("location.unknownOs")}</span>
        : <span>{failed ? t("location.hostUnavailable") : t("common.loading")}</span>}
    </div>
  );
}
