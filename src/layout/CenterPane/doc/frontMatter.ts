//! YAML front matter handling for the visual editor.
//!
//! Milkdown has no front matter node: `---\ntitle: x\n---` parses as a thematic break followed by a
//! setext heading, so a single edit would rewrite it. The visual editor therefore receives only the
//! body, and the prefix is kept byte-for-byte and edited separately.

/** A front matter block must open the file; the closing fence may end the file. */
const FRONT_MATTER = /^---[ \t]*(\r?\n)(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/;

export interface FrontMatterSplit {
  /** Exact front matter text including both fences and the trailing line break, or "" when absent. */
  prefix: string;
  body: string;
}

export function splitFrontMatter(text: string): FrontMatterSplit {
  const match = FRONT_MATTER.exec(text);
  return match ? { prefix: match[0], body: text.slice(match[0].length) } : { prefix: "", body: text };
}

/** YAML between the fences, without the fence lines. */
export function frontMatterYaml(prefix: string): string {
  const lines = prefix.split(/\r?\n/);
  // A trailing line break leaves an empty final element after the closing fence.
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.slice(1, -1).join(prefix.includes("\r\n") ? "\r\n" : "\n");
}

/** Rebuild the prefix around edited YAML, keeping the original fences and line-break style. */
export function withFrontMatterYaml(prefix: string, yaml: string): string {
  const eol = prefix.includes("\r\n") ? "\r\n" : "\n";
  const lines = prefix.split(/\r?\n/);
  const trailing = lines[lines.length - 1] === "" ? eol : "";
  if (trailing) lines.pop();
  const open = lines[0];
  const close = lines[lines.length - 1];
  const inner = yaml.replace(/\r?\n/g, eol);
  return `${open}${eol}${inner ? inner + eol : ""}${close}${trailing}`;
}

/** Number of source lines taken by the prefix, used to offset body line numbers. */
export function frontMatterLines(prefix: string): number {
  if (!prefix) return 0;
  const breaks = prefix.split("\n").length - 1;
  return prefix.endsWith("\n") ? breaks : breaks + 1;
}
