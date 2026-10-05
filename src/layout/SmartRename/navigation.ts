//! Recoverable agent selection; navigating never starts a title generation request.

import { useEffect, useState } from "react";

export interface SmartRenameRoute { sessionId: string; agent: string }

export function readSmartRenameRoute(): SmartRenameRoute | null {
  const query = new URLSearchParams(window.location.search);
  const sessionId = query.get("smartRename");
  return sessionId ? { sessionId, agent: query.get("smartRenameAgent") ?? "" } : null;
}

export function smartRenameUrl(sessionId: string | null): string {
  const url = new URL(window.location.href);
  url.searchParams.delete("smartRename"); url.searchParams.delete("smartRenameAgent");
  if (sessionId) url.searchParams.set("smartRename", sessionId);
  return url.href;
}

export function navigateSmartRename(sessionId: string | null, replace = false) {
  const url = smartRenameUrl(sessionId);
  if (url === window.location.href) return;
  window.history[replace ? "replaceState" : "pushState"](null, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function writeSmartRenameAgent(agent: string) {
  const url = new URL(window.location.href);
  if (agent) url.searchParams.set("smartRenameAgent", agent); else url.searchParams.delete("smartRenameAgent");
  window.history.replaceState(null, "", url);
}

export function useSmartRenameRoute() {
  const [route, setRoute] = useState(readSmartRenameRoute);
  useEffect(() => {
    const update = () => setRoute(readSmartRenameRoute());
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  return route;
}
