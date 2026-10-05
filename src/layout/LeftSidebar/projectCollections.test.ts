import { describe, expect, it } from "vitest";
import type { Project } from "../../types";
import { arrangeProjectsInCollections } from "./projectCollectionLayout";
import { resolveProjectDrop } from "./projectCollectionDrop";
import { moveToCollectionItem } from "./projectCollectionMenu";
import { t } from "../../i18n";

const project = (id: string, collectionId: string | null = null, rootPath = `/tmp/${id}`): Project => ({
  id, name: id, collectionId, rootPath, collapsed: false, sortOrder: 0, createdAt: 0,
});

describe("collection membership projection", () => {
  const work = project("work", null, "");
  const notes = project("notes", "work", "");
  const repo = project("repo", "notes");
  const loose = project("loose");
  const projects = [loose, repo, work, notes];

  it("preserves nested membership, sibling order, counts and indentation", () => {
    expect(arrangeProjectsInCollections(projects, () => true).map(e => [e.project.id, e.indent, e.projectCount]))
      .toEqual([["work", 0, 1], ["notes", 1, 1], ["repo", 2, 0], ["loose", 0, 0]]);
  });
  it("hides an entire collapsed branch while keeping loose projects", () => {
    expect(arrangeProjectsInCollections(projects, p => p.id !== "work").map(e => e.project.id)).toEqual(["work", "loose"]);
  });
  it("renders orphaned projects and malformed cycles without dropping or repeating rows", () => {
    const bad = [project("a", "b", ""), project("b", "a", ""), project("orphan", "gone")];
    expect(new Set(arrangeProjectsInCollections(bad, () => true).map(e => e.project.id))).toEqual(new Set(["a", "b", "orphan"]));
  });
  it("rejects self-membership and cycles in both drag and menu choices", () => {
    expect(resolveProjectDrop({ kind: "project", id: "work" }, notes, projects)).toBeNull();
    expect(resolveProjectDrop({ kind: "project", id: "work" }, work, projects)).toBeNull();
    const menu = moveToCollectionItem(t, work, projects, () => {});
    expect(menu?.submenu?.filter(i => i.label === "work" || i.label === "notes").every(i => i.disabled)).toBe(true);
  });
  it("joins a collection, joins another project's collection, or detaches beside a loose project", () => {
    expect(resolveProjectDrop({ kind: "project", id: "loose" }, notes, projects)).toEqual({ projectId: "loose", collectionId: "notes" });
    expect(resolveProjectDrop({ kind: "project", id: "loose" }, repo, projects)).toEqual({ projectId: "loose", collectionId: "notes" });
    expect(resolveProjectDrop({ kind: "project", id: "repo" }, loose, projects)).toEqual({ projectId: "repo", collectionId: null });
    expect(resolveProjectDrop({ kind: "session", id: "repo" }, work, projects)).toBeNull();
  });
});
