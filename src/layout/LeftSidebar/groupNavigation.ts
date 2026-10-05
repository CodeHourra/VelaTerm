//! Group creation uses a recoverable presentation URL without replaying a mutation.

import { useEffect, useState } from "react";

export interface NewGroupRoute { projectId: string; parentGroupId: string | null }
const KEYS = ["groupDialog", "groupProjectId", "groupParentId", "groupName"];
let lockedHref: string | null = null;

export function readNewGroupRoute(): NewGroupRoute | null {
  const query = new URLSearchParams(window.location.search);
  const projectId = query.get("groupProjectId");
  return query.get("groupDialog") === "create" && projectId
    ? { projectId, parentGroupId: query.get("groupParentId") } : null;
}

export function newGroupDialogUrl(projectId: string | null, parentGroupId: string | null = null): string {
  const url = new URL(window.location.href);
  KEYS.forEach(key => url.searchParams.delete(key));
  if (projectId) {
    url.searchParams.set("groupDialog", "create");
    url.searchParams.set("groupProjectId", projectId);
    if (parentGroupId) url.searchParams.set("groupParentId", parentGroupId);
  }
  return url.href;
}

export function navigateNewGroup(projectId: string | null, parentGroupId: string | null = null) {
  if (lockedHref) return;
  const href = newGroupDialogUrl(projectId, parentGroupId);
  if (href === window.location.href) return;
  window.history.pushState(null, "", href);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function readGroupDraft(): string { return new URLSearchParams(window.location.search).get("groupName") ?? ""; }

export function writeGroupDraft(name: string) {
  if (!readNewGroupRoute()) return;
  const url = new URL(window.location.href);
  if (name) url.searchParams.set("groupName", name); else url.searchParams.delete("groupName");
  window.history.replaceState(null, "", url);
}

export function lockGroupNavigation(busy: boolean) { lockedHref = busy ? window.location.href : null; }

export function useNewGroupRoute(enabled: boolean) {
  const [route, setRoute] = useState(() => enabled ? readNewGroupRoute() : null);
  useEffect(() => {
    if (!enabled) return;
    const update = () => {
      if (lockedHref && window.location.href !== lockedHref) window.history.replaceState(null, "", lockedHref);
      setRoute(readNewGroupRoute());
    };
    update();
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, [enabled]);
  return route;
}
