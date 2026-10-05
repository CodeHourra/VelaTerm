import { useEffect, useState } from "react";
import AgentSelect from "../../components/AgentSelect";
import { Backdrop } from "../../components/Backdrop";
import { FormModal } from "../../components/FormModal";
import { LaunchLoadState } from "../../components/LaunchFields";
import { useT, type I18nKey } from "../../i18n";
import { renameSessionWithAgent, sessionTitleOptions } from "../../ipc/tree";
import type { SessionKind } from "../../types";
import { navigateSmartRename, readSmartRenameRoute, useSmartRenameRoute, writeSmartRenameAgent, type SmartRenameRoute as Route } from "./navigation";

const ERROR_KEYS: Record<string, I18nKey> = {
  agent_unavailable: "sessionTitle.agentUnavailable", empty: "sessionTitle.unavailable",
  unavailable: "sessionTitle.unavailable", unsupported: "sessionTitle.unavailable",
  busy: "sessionTitle.busy", too_large: "sessionTitle.tooLarge", timeout: "sessionTitle.timeout",
  invalid: "sessionTitle.invalid", changed: "sessionTitle.changed",
};
export function titleErrorKey(error: unknown): I18nKey {
  return ERROR_KEYS[String(error).match(/session_title:([a-z_]+)/)?.[1] ?? ""] ?? "sessionTitle.failed";
}

export function SmartRenameRoute() {
  const route = useSmartRenameRoute();
  return route ? <AgentChoice route={route} key={route.sessionId} /> : null;
}

function AgentChoice({ route }: { route: Route }) {
  const t = useT();
  const [data, setData] = useState<Awaited<ReturnType<typeof sessionTitleOptions>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const close = () => navigateSmartRename(null);
  useEffect(() => {
    let live = true;
    setData(null); setError(null);
    void sessionTitleOptions(route.sessionId).then(value => { if (live) setData(value); })
      .catch(cause => { if (live) setError(t(titleErrorKey(cause))); });
    return () => { live = false; };
  }, [route.sessionId, revision, t]);
  if (!data) return <Backdrop onClose={close}><section className="launch-dialog launch-single" role="dialog"
    aria-modal="true" aria-label={t("sessionTitle.rename")} onKeyDown={event => { if (event.key === "Escape") close(); }}>
    <h2>{t("sessionTitle.rename")}</h2>
    <LaunchLoadState state={error ? "error" : "loading"} error={error} retry={() => setRevision(value => value + 1)} />
    <footer className="launch-footer"><button className="vlx-btn" onClick={close}>{t("common.cancel")}</button></footer>
  </section></Backdrop>;
  return <FormModal key={`${route.sessionId}:${route.agent}`} title={t("sessionTitle.rename")}
    initial={{ agent: route.agent }} submitLabel={t("common.rename")}
    fields={[{ key: "agent", label: t("orch.agentLabel"), required: true, render: (value, change) => <>
      <p style={{ margin: "0 0 12px", color: "var(--text-secondary)", fontSize: 12 }}>{t("sessionTitle.chooseAgentHint")}</p>
      <AgentSelect value={value as SessionKind | ""} onChange={change} options={data.agents}
        placeholder={t("orch.agentLabel")} />
    </> }]}
    validate={values => !data.agents.some(option => option.available) ? t("sessionTitle.noAgent")
      : values.agent && !data.agents.some(option => option.id === values.agent && option.available)
        ? t("sessionTitle.agentUnavailable") : null}
    onValuesChange={values => writeSmartRenameAgent(values.agent)}
    formatSubmitError={cause => t(titleErrorKey(cause))} onCancel={close}
    onSubmit={async values => {
      await renameSessionWithAgent(route.sessionId, values.agent as SessionKind);
      if (readSmartRenameRoute()?.sessionId === route.sessionId) navigateSmartRename(null, true);
    }} />;
}
