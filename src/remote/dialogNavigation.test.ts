import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { navigateProjectDialog, restoreLockedDialog, useDialogNavigationLock } from "./dialogNavigation";

beforeEach(() => window.history.replaceState(null, "", "/?projectDialog=create&projectCollectionId=parent&projectName=Research"));

it("keeps a running creation's parent and draft when navigating to another destination", () => {
  const { unmount } = renderHook(() => useDialogNavigationLock("create", true));
  act(() => navigateProjectDialog("create", true, false, "other"));
  expect(restoreLockedDialog()).toBe(true);
  const query = new URLSearchParams(window.location.search);
  expect(query.get("projectCollectionId")).toBe("parent");
  expect(query.get("projectName")).toBe("Research");
  unmount();
});

it("lets a successful creation close the route before its busy effect is cleaned up", () => {
  const { result, unmount } = renderHook(() => useDialogNavigationLock("create", true));
  act(() => {
    result.current();
    navigateProjectDialog("create", false);
  });
  expect(restoreLockedDialog()).toBe(false);
  expect(window.location.search).toBe("");
  unmount();
});
