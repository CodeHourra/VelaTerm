//! Flatten collection membership independently of each project's own groups and sessions.

import { collectionsFirst, isVirtualProject, type Project } from "../../types";

export interface ProjectListEntry {
  project: Project;
  indent: number;
  projectCount: number;
}

/** Missing parents are rendered at the top level. A visited set also keeps a malformed external snapshot usable. */
export function arrangeProjectsInCollections(
  projects: Project[],
  isExpanded: (project: Project) => boolean,
): ProjectListEntry[] {
  const byId = new Map(projects.map(p => [p.id, p]));
  const children = new Map<string, Project[]>();
  const roots: Project[] = [];
  for (const project of projects) {
    const parent = project.collectionId ? byId.get(project.collectionId) : undefined;
    if (parent && isVirtualProject(parent) && parent.id !== project.id) {
      const members = children.get(parent.id) ?? [];
      members.push(project);
      children.set(parent.id, members);
    } else roots.push(project);
  }
  const seen = new Set<string>();
  const out: ProjectListEntry[] = [];
  const visit = (project: Project, indent: number) => {
    if (seen.has(project.id)) return;
    seen.add(project.id);
    const members = children.get(project.id) ?? [];
    out.push({ project, indent, projectCount: members.length });
    if (isExpanded(project)) for (const member of collectionsFirst(members)) visit(member, indent + 1);
  };
  for (const project of collectionsFirst(roots)) visit(project, 0);
  // Unreachable cycles are shown as loose only; children of intentionally collapsed parents stay hidden.
  for (const project of projects) {
    let current: Project | undefined = project;
    const chain = new Set<string>();
    while (current?.collectionId && !chain.has(current.id)) {
      if (seen.has(current.id)) break;
      chain.add(current.id);
      current = byId.get(current.collectionId);
    }
    if (current && chain.has(current.id)) visit(project, 0);
  }
  return out;
}
