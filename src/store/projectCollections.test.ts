//! Mutation failures recover persisted membership and collapse state and remain visible for correction.

import { beforeEach, expect, it, vi } from "vitest";

const ipc = vi.hoisted(() => ({
  listTree: vi.fn(),
  setCollapsed: vi.fn(),
  setProjectCollection: vi.fn(),
  importProject: vi.fn(),
  createVirtualProject: vi.fn(),
}));
vi.mock("../ipc/commands", () => ({
  createWorktree: vi.fn(),
  getSessionCwd: vi.fn().mockResolvedValue(null),
  ptyKill: vi.fn().mockResolvedValue(undefined),
  ptyWrite: vi.fn().mockResolvedValue(undefined),
  listShells: vi.fn().mockResolvedValue([]),
}));
vi.mock("../ipc/tree", () => ipc);
vi.mock("../notify", () => ({
  notify: vi.fn(),
  getNotifyPermission: vi.fn().mockResolvedValue("granted"),
  requestNotifyPermission: vi.fn().mockResolvedValue("granted"),
  getEffectiveNotifyPermission: vi.fn().mockResolvedValue("granted"),
  requestEffectiveNotifyPermission: vi.fn().mockResolvedValue("granted"),
}));

import { useTermStore } from "./termStore";
import { setProjectCollection } from "./projectCollections";
import type { Project } from "../types";

const collection = (id: string, collapsed = false): Project => ({ id, name: id, rootPath: "", sortOrder: 1, collapsed, createdAt: 0 });

beforeEach(() => {
  for (const fn of Object.values(ipc)) fn.mockReset();
  ipc.listTree.mockResolvedValue({ projects: [collection("c1")], groups: [], sessions: [] });
  ipc.setCollapsed.mockResolvedValue(undefined);
  ipc.setProjectCollection.mockResolvedValue(undefined);
  useTermStore.setState({ projects: [collection("c1")], groups: [], sessions: [], treeMutationError: null });
  window.history.replaceState(null, "", "/");
});

it("reloads authoritative membership and displays a rejected move", async () => {
  ipc.setProjectCollection.mockRejectedValue(new Error("Collection not found"));
  await expect(setProjectCollection("p1", "gone")).rejects.toThrow("Collection not found");
  expect(ipc.listTree).toHaveBeenCalled();
  expect(useTermStore.getState().treeMutationError).toBe("Collection not found");
  expect(useTermStore.getState().projects[0].id).toBe("c1");
});

it("recovers collection collapse and displays a persistence failure", async () => {
  ipc.setCollapsed.mockRejectedValue(new Error("Database unavailable"));
  await useTermStore.getState().toggleCollapsed("project", "c1");
  expect(useTermStore.getState().projects[0].collapsed).toBe(false);
  expect(useTermStore.getState().treeMutationError).toBe("Database unavailable");
  expect(ipc.listTree).toHaveBeenCalled();
});

it("a successful retry clears the previous failure", async () => {
  useTermStore.setState({ treeMutationError: "failed" });
  await setProjectCollection("p1", null);
  expect(useTermStore.getState().treeMutationError).toBeNull();
});

it("recovers the import destination from the picker URL and closes the route after success", async () => {
  window.history.replaceState(null, "", "/?projectDialog=open&projectCollectionId=c1");
  ipc.importProject.mockResolvedValue({ ...collection("p1"), rootPath: "/tmp/project", collectionId: "c1" });
  await useTermStore.getState().importProjectPath("/tmp/project");
  expect(ipc.importProject).toHaveBeenCalledWith("/tmp/project", "c1");
  expect(window.location.search).toBe("");
});

it("passes child collection membership through creation without a separate move", async () => {
  ipc.createVirtualProject.mockResolvedValue({ ...collection("child"), collectionId: "c1" });
  await useTermStore.getState().addVirtualProject("Research", "c1");
  expect(ipc.createVirtualProject).toHaveBeenCalledWith("Research", "c1");
  expect(ipc.setProjectCollection).not.toHaveBeenCalled();
});
