//! Resolve a Markdown link target for Cmd/Ctrl+click in the visual editor.

export type DocLinkTarget =
  | { kind: "anchor"; id: string }
  | { kind: "external"; url: string }
  | { kind: "file"; path: string; anchor: string };

const EXTERNAL = /^(?:https?|mailto|tel|ftp):/i;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const WINDOWS_ABSOLUTE = /^[a-z]:[\\/]/i;

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Join a relative path onto a directory, collapsing `.` and `..` with the document's separator. */
function joinPath(dir: string, relative: string, sep: string): string {
  const parts = dir.split(/[\\/]/);
  for (const part of relative.split(/[\\/]/)) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length > 1) parts.pop();
    } else parts.push(part);
  }
  return parts.join(sep);
}

/** Classify `href` relative to the open document; null when it cannot be followed. */
export function resolveDocLink(href: string, docPath: string): DocLinkTarget | null {
  const raw = href.trim();
  if (!raw) return null;
  if (raw.startsWith("#")) return raw.length > 1 ? { kind: "anchor", id: decode(raw.slice(1)) } : null;
  if (EXTERNAL.test(raw)) return { kind: "external", url: raw };
  if (/^www\./i.test(raw)) return { kind: "external", url: `https://${raw}` };
  let target = raw;
  if (/^file:\/\//i.test(target)) {
    target = target.replace(/^file:\/\/(?:localhost)?/i, "");
    // file:///C:/dir → C:/dir
    if (/^\/[a-z]:\//i.test(target)) target = target.slice(1);
  } else if (SCHEME.test(target) && !WINDOWS_ABSOLUTE.test(target)) {
    // Other schemes such as javascript: are never followed.
    return null;
  }
  const hash = target.indexOf("#");
  const anchor = hash >= 0 ? decode(target.slice(hash + 1)) : "";
  const pathPart = decode((hash >= 0 ? target.slice(0, hash) : target).replace(/\?.*$/, ""));
  if (!pathPart) return anchor ? { kind: "anchor", id: anchor } : null;
  const sep = docPath.includes("\\") && !docPath.includes("/") ? "\\" : "/";
  if (pathPart.startsWith("/") || WINDOWS_ABSOLUTE.test(pathPart)) return { kind: "file", path: pathPart, anchor };
  // A draft has no directory to resolve against.
  if (!docPath) return null;
  const dir = docPath.slice(0, Math.max(docPath.lastIndexOf("/"), docPath.lastIndexOf("\\")));
  return { kind: "file", path: joinPath(dir, pathPart, sep), anchor };
}

/** GitHub-style heading slug, the form most Markdown tools use for `#anchor` links. */
export function headingSlug(text: string): string {
  return text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");
}
