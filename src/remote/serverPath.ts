//! Path helpers for folders on the server, which may run a different OS than the client: a browser on a Mac
//! can browse a Windows host. Every helper takes the server's path flavor explicitly instead of assuming `/`.
//! Windows paths are drive-rooted (`C:\Users`) or UNC-rooted (`\\server\share\dir`); POSIX paths start at `/`.

import { invoke } from "../ipc/transport";

export type PathFlavor = "posix" | "win";

/** Infer the flavor from any absolute path the server produced, typically its home directory. */
export function detectFlavor(sample: string): PathFlavor {
  return /^[A-Za-z]:([\\/]|$)/.test(sample) || sample.startsWith("\\\\") ? "win" : "posix";
}

export function sepOf(flavor: PathFlavor): string {
  return flavor === "win" ? "\\" : "/";
}

/** Split an absolute path into its root (`/`, `C:\`, `\\server\share\`) and the segments below it. */
export function splitPath(path: string, flavor: PathFlavor): { root: string; parts: string[] } {
  if (flavor === "win") {
    const p = path.replace(/\//g, "\\");
    const unc = /^\\\\([^\\]+)\\([^\\]+)(.*)$/.exec(p);
    if (unc) return { root: `\\\\${unc[1]}\\${unc[2]}\\`, parts: unc[3].split("\\").filter(Boolean) };
    const drive = /^([A-Za-z]):(.*)$/.exec(p);
    if (drive) return { root: `${drive[1].toUpperCase()}:\\`, parts: drive[2].split("\\").filter(Boolean) };
    return { root: "", parts: p.split("\\").filter(Boolean) };
  }
  return { root: path.startsWith("/") ? "/" : "", parts: path.split("/").filter(Boolean) };
}

function assemble(root: string, parts: string[], flavor: PathFlavor): string {
  return root + parts.join(sepOf(flavor));
}

/** Canonical form: one separator between segments, no trailing separator except on a root. */
export function normalizePath(path: string, flavor: PathFlavor): string {
  const { root, parts } = splitPath(path.trim(), flavor);
  return assemble(root, parts, flavor);
}

export function isAbsolutePath(path: string, flavor: PathFlavor): boolean {
  return splitPath(path.trim(), flavor).root !== "";
}

/** Join a directory and one child name. Without a flavor, infer it from the directory itself. */
export function joinPath(dir: string, name: string, flavor: PathFlavor = detectFlavor(dir)): string {
  const { root, parts } = splitPath(dir, flavor);
  return assemble(root, [...parts, name], flavor);
}

/** Parent directory; a root is its own parent. */
export function parentPath(path: string, flavor: PathFlavor): string {
  const { root, parts } = splitPath(path, flavor);
  return assemble(root, parts.slice(0, -1), flavor);
}

/** Final segment, or the root itself (`/`, `C:`) for a root. */
export function baseName(path: string, flavor: PathFlavor): string {
  const { root, parts } = splitPath(path, flavor);
  return parts[parts.length - 1] ?? rootLabel(root);
}

/** Display label of a root: `/` stays `/`, `C:\` becomes `C:`, UNC keeps its server and share. */
export function rootLabel(root: string): string {
  return root === "/" ? "/" : root.replace(/\\$/, "");
}

/** Clickable path segments from the root down to the path itself. */
export function pathCrumbs(path: string, flavor: PathFlavor): { name: string; path: string }[] {
  const { root, parts } = splitPath(path, flavor);
  const out = [{ name: rootLabel(root), path: root }];
  parts.forEach((part, i) => out.push({ name: part, path: assemble(root, parts.slice(0, i + 1), flavor) }));
  return out;
}

/** Expand a leading `~` to the server's home directory. */
export function expandHome(path: string, home: string, flavor: PathFlavor): string {
  const p = path.trim();
  if (!home || !(p === "~" || p.startsWith("~/") || p.startsWith("~\\"))) return p;
  return p === "~" ? home : joinPath(home, p.slice(2), flavor);
}

/** Case-insensitive comparison on the file systems that behave that way by default. */
export function samePath(a: string, b: string, flavor: PathFlavor, caseInsensitive = flavor === "win"): boolean {
  const x = normalizePath(a, flavor);
  const y = normalizePath(b, flavor);
  return caseInsensitive ? x.toLowerCase() === y.toLowerCase() : x === y;
}

export interface ServerFs {
  /** `macos`, `linux`, `windows`, or another Rust `std::env::consts::OS` value. */
  os: string;
  hostName: string | null;
  home: string;
  /** `/` on POSIX hosts; mounted drive roots such as `C:\` on Windows. */
  roots: string[];
  flavor: PathFlavor;
}

let cached: Promise<ServerFs> | null = null;

/**
 * Home directory, OS, and roots of the server this window talks to. Missing metadata never invents a root.
 */
export function serverFs(refresh = false): Promise<ServerFs> {
  if (refresh) cached = null;
  if (!cached) {
    cached = invoke<{ os: string; roots: string[]; home?: string | null; hostName?: string | null }>("list_roots").then(async (info) => {
      const home = info.home ?? await invoke<string | null>("home_dir");
      if (!home || !info.os || !info.roots.length) throw new Error("SERVER_FS_UNAVAILABLE");
      const flavor = info.os === "windows" ? "win" : "posix";
      return { os: info.os, hostName: info.hostName ?? null, home, roots: info.roots, flavor };
    });
    cached.catch(() => {
      cached = null;
    });
  }
  return cached;
}
