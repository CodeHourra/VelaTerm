//! Reading-position mapping between the visual and source views.
//!
//! Neither editor knows the other's layout, so a position is expressed structurally: the heading
//! section, the block ordinal inside that section, and a fraction within the block. Visual blocks are
//! the top-level ProseMirror nodes; source blocks come from a light Markdown scan that mirrors how
//! CommonMark splits the same text. Both sides count headings the same way, so small disagreements
//! inside one section cannot drift into the rest of the document.

import { frontMatterLines, splitFrontMatter } from "./frontMatter";

export interface SourceBlock {
  /** First and last zero-based line of the block in the full source text, inclusive. */
  start: number;
  end: number;
  heading: boolean;
}

export interface ReadingAnchor {
  /** Heading section index; -1 for content before the first heading. */
  section: number;
  /** Block ordinal inside the section, where the heading itself is 0. */
  ordinal: number;
  /** Position inside the block, 0 at its top and 1 at its bottom. */
  fraction: number;
  /** Distance in pixels from the viewport top, so the anchor keeps its height on screen. */
  offset: number;
  /** Whether the anchor is the caret, which the target view should then move to. */
  caret: boolean;
}

type Kind = "para" | "list" | "quote" | "fence";
const ATX = /^\s{0,3}#{1,6}(?:\s|$)/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const SETEXT = /^\s{0,3}(?:=+|-+)\s*$/;
const BREAK = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const LIST = /^\s{0,3}(?:[-*+]|\d{1,9}[.)])(?:\s|$)/;
const QUOTE = /^\s{0,3}>/;

/** Split Markdown into the blocks ProseMirror would create as top-level nodes. */
export function sourceBlocks(text: string): SourceBlock[] {
  type Open = SourceBlock & { kind: Kind };
  const lines = text.split("\n");
  const blocks: SourceBlock[] = [];
  const state: { current: Open | null; fence: string | null; blank: boolean } = { current: null, fence: null, blank: false };
  const close = () => {
    const block = state.current;
    if (block) blocks.push({ start: block.start, end: block.end, heading: block.heading });
    state.current = null;
  };
  const open = (i: number, kind: Kind): Open => {
    close();
    return (state.current = { start: i, end: i, heading: false, kind });
  };
  for (let i = frontMatterLines(splitFrontMatter(text).prefix); i < lines.length; i++) {
    const line = lines[i];
    const block = state.current;
    if (state.fence != null && block) {
      block.end = i;
      const closing = FENCE.exec(line);
      if (closing && closing[1][0] === state.fence[0] && closing[1].length >= state.fence.length && !line.trim().slice(closing[1].length).trim()) {
        state.fence = null;
        close();
      }
      continue;
    }
    if (!line.trim()) {
      state.blank = true;
      continue;
    }
    const afterBlank = state.blank;
    state.blank = false;
    if (ATX.test(line)) {
      open(i, "para").heading = true;
      close();
      continue;
    }
    const opening = FENCE.exec(line);
    if (opening) {
      open(i, "fence");
      state.fence = opening[1];
      continue;
    }
    if (block && !afterBlank && block.kind === "para" && !block.heading && SETEXT.test(line)) {
      block.end = i;
      block.heading = true;
      close();
      continue;
    }
    if (BREAK.test(line)) {
      open(i, "para");
      close();
      continue;
    }
    const kind: Kind = LIST.test(line) ? "list" : QUOTE.test(line) ? "quote" : "para";
    const continues = block && (afterBlank
      // Loose lists keep blank lines between items but stay one list node.
      ? block.kind === "list" && (kind === "list" || /^(?: {2,}|\t)/.test(line))
      // Lists and quotes interrupt a paragraph; anything else extends the current block.
      : block.kind === kind || kind === "para");
    if (continues) block.end = i;
    else open(i, kind);
  }
  close();
  return blocks;
}

/** Build an anchor from block `index` of a view whose heading flags are `headings`. */
export function anchorAt(headings: boolean[], index: number, fraction: number, offset: number, caret: boolean): ReadingAnchor {
  let section = -1;
  let start = 0;
  for (let i = 0; i <= index && i < headings.length; i++) {
    if (headings[i]) {
      section += 1;
      start = i;
    }
  }
  return { section, ordinal: index - start, fraction, offset, caret };
}

/** Resolve an anchor against the target view's heading flags, clamping inside its section. */
export function resolveAnchor(headings: boolean[], anchor: ReadingAnchor): { index: number; fraction: number } {
  if (!headings.length) return { index: 0, fraction: 0 };
  const starts = headings.flatMap((heading, i) => (heading ? [i] : []));
  if (anchor.section >= starts.length) return { index: headings.length - 1, fraction: 1 };
  const start = anchor.section < 0 ? 0 : starts[anchor.section];
  const next = starts[anchor.section + 1] ?? headings.length;
  const index = start + anchor.ordinal;
  if (index < next) return { index, fraction: anchor.fraction };
  // The target section is shorter: stay at its end rather than spilling into the next section.
  return next > start ? { index: next - 1, fraction: 1 } : { index: start, fraction: 0 };
}

/** Locate a fractional source line within the blocks; gaps resolve to the following block. */
export function blockAtLine(blocks: SourceBlock[], line: number): { index: number; fraction: number } {
  for (let i = 0; i < blocks.length; i++) {
    const { start, end } = blocks[i];
    if (line < start) return { index: i, fraction: 0 };
    if (line < end + 1) return { index: i, fraction: (line - start) / (end + 1 - start) };
  }
  return { index: Math.max(0, blocks.length - 1), fraction: 1 };
}

/** Fractional source line for a block position. */
export function lineAtBlock(blocks: SourceBlock[], index: number, fraction: number): number {
  const block = blocks[index];
  if (!block) return 0;
  return block.start + Math.min(fraction, 0.999) * (block.end + 1 - block.start);
}
