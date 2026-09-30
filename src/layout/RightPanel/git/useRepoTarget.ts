//! Chooses which repository the Git tab works on.
//!
//! Usually that is the working directory itself. When the directory is not inside a repository but
//! holds several (a workspace folder of sibling checkouts), the tab lists the ones found below it and
//! works on the one the user picks. The pick is remembered per folder for the rest of the app run.

import { useCallback, useEffect, useState } from "react";
import { gitDiscoverRepos, type NestedRepo } from "../../../ipc/commands";
import { getGitStatus } from "../../../ipc/info";

/** Folder -> repository last picked in it. */
const picked = new Map<string, string>();

interface Scan {
  root: string;
  repos: NestedRepo[];
}

export interface RepoTarget {
  /** Repositories found below the folder; empty when the folder is a repository or holds none. */
  repos: NestedRepo[];
  /** Directory the Git tab should operate on; null while the folder is still being checked. */
  repoPath: string | null;
  select: (repoPath: string) => void;
  /** Scans the folder again, e.g. after a repository was cloned into it. */
  rescan: () => void;
}

export function useRepoTarget(path: string | null): RepoTarget {
  const [scan, setScan] = useState<Scan | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const rescan = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    void (async () => {
      const status = await getGitStatus(path).catch(() => null);
      // Inside a repository, or Git is unavailable: the folder itself is the target.
      const repos = status && !status.isRepo ? await gitDiscoverRepos(path).catch(() => []) : [];
      if (cancelled) return;
      setScan({ root: path, repos });
      setSelected((current) => {
        const keep = (p: string | null | undefined) => (p && repos.some((r) => r.path === p) ? p : null);
        return keep(current) ?? keep(picked.get(path)) ?? repos[0]?.path ?? null;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [path, tick]);

  const select = useCallback(
    (repoPath: string) => {
      if (path) picked.set(path, repoPath);
      setSelected(repoPath);
    },
    [path],
  );

  // A scan of the previous folder must not leak into the new one while its own scan is running.
  const current = scan && scan.root === path ? scan : null;
  const repos = current?.repos ?? [];
  const repoPath = !path || !current ? null : repos.length > 0 ? selected : path;
  return { repos, repoPath, select, rescan };
}
