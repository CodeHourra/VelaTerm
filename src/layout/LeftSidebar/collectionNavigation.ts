//! Collection forms have recoverable URLs. Navigation only presents a form and never replays a mutation.

import { useEffect, useState } from "react";

export interface CollectionDialogRoute { kind: "create" | "rename"; id: string | null; draft: string | null; parentId: string | null }
let lockedHref: string | null = null;

export function readCollectionDialog(): CollectionDialogRoute | null {
  const query = new URLSearchParams(window.location.search);
  const kind = query.get("collectionDialog");
  const id = query.get("collectionId");
  return kind === "create" || (kind === "rename" && id)
    ? { kind, id: kind === "rename" ? id : null, draft: query.get("collectionName"), parentId: kind === "create" ? query.get("collectionParentId") : null } : null;
}

export function collectionDialogUrl(kind: "create" | "rename" | null, id?: string, parentId?: string): string {
  const url = new URL(window.location.href);
  for (const key of ["collectionDialog", "collectionId", "collectionName", "collectionParentId"]) url.searchParams.delete(key);
  if (kind) url.searchParams.set("collectionDialog", kind);
  if (kind === "rename" && id) url.searchParams.set("collectionId", id);
  if (kind === "create" && parentId) url.searchParams.set("collectionParentId", parentId);
  return url.href;
}

export function navigateCollectionDialog(kind: "create" | "rename" | null, id?: string, parentId?: string) {
  if (lockedHref) return;
  const href = collectionDialogUrl(kind, id, parentId);
  if (href === window.location.href) return;
  window.history.pushState(null, "", href);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function writeCollectionDraft(name: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("collectionName", name);
  window.history.replaceState(null, "", url);
}

export function lockCollectionNavigation(busy: boolean) { lockedHref = busy ? window.location.href : null; }

export function useCollectionDialog() {
  const [route, setRoute] = useState(readCollectionDialog);
  useEffect(() => {
    const update = () => {
      if (lockedHref && window.location.href !== lockedHref) {
        window.history.replaceState(null, "", lockedHref);
        return;
      }
      setRoute(readCollectionDialog());
    };
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  return route;
}
