import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { lockGroupNavigation, navigateNewGroup, newGroupDialogUrl, readGroupDraft, readNewGroupRoute, useNewGroupRoute, writeGroupDraft } from "./groupNavigation";

beforeEach(() => {
  lockGroupNavigation(false);
  window.history.replaceState(null, "", "/");
});

it("opens a child-group form with a link and restores its parent and draft without a mutation", () => {
  window.history.replaceState(null, "", newGroupDialogUrl("collection", "parent"));
  writeGroupDraft("Research");
  const { result, unmount } = renderHook(() => useNewGroupRoute(true));
  expect(result.current).toEqual({ projectId: "collection", parentGroupId: "parent" });
  expect(readGroupDraft()).toBe("Research");
  const href = window.location.href;
  act(() => navigateNewGroup(null));
  expect(result.current).toBeNull();
  expect(window.location.search).toBe("");
  act(() => {
    window.history.replaceState(null, "", href);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(result.current).toEqual({ projectId: "collection", parentGroupId: "parent" });
  expect(readGroupDraft()).toBe("Research");
  unmount();
});

it("keeps the running form's parent and name until completion allows closing", () => {
  navigateNewGroup("collection", "parent");
  writeGroupDraft("Research");
  const { result, unmount } = renderHook(() => useNewGroupRoute(true));
  lockGroupNavigation(true);
  act(() => {
    window.history.replaceState(null, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(result.current).toEqual({ projectId: "collection", parentGroupId: "parent" });
  expect(readGroupDraft()).toBe("Research");
  act(() => navigateNewGroup(null));
  expect(readNewGroupRoute()).not.toBeNull();
  lockGroupNavigation(false);
  act(() => navigateNewGroup(null));
  expect(result.current).toBeNull();
  unmount();
});

it("renders a URL-backed group form only in the sidebar hook owner", () => {
  navigateNewGroup("collection");
  const { result, unmount } = renderHook(() => useNewGroupRoute(false));
  expect(result.current).toBeNull();
  unmount();
});
