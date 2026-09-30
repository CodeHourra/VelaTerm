//! Document statistics for the status bar, counted from Markdown with the syntax removed.
//!
//! Each CJK character counts as one word, as in Typora and common word processors; Latin text counts
//! runs of letters and digits. Characters exclude whitespace.

import { splitFrontMatter } from "./frontMatter";

export interface DocStats {
  words: number;
  characters: number;
  lines: number;
  /** Estimated reading time in whole minutes; 0 for an empty document. */
  minutes: number;
}

const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/gu;
const LATIN_WORD = /[\p{L}\p{N}]+(?:['’\-.][\p{L}\p{N}]+)*/gu;
/** Typical silent reading speeds: words per minute for Latin text, characters per minute for CJK. */
const LATIN_WPM = 230;
const CJK_CPM = 400;

/** Reduce Markdown to its readable text. Code content is kept; its fences are not. */
export function plainText(markdown: string): string {
  return splitFrontMatter(markdown).body
    .replace(/^\s{0,3}(`{3,}|~{3,}).*$/gm, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>\n]+>/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}\[[^\]]+\]:\s+\S.*$/gm, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}(?:[-*_]\s*){3,}$/gm, "")
    .replace(/^\s{0,3}(?:=+|-+)\s*$/gm, "")
    .replace(/^\s*>+\s?/gm, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm, "")
    .replace(/^\s*\|?(?:\s*:?-+:?\s*\|)+\s*:?-*:?\s*$/gm, "")
    .replace(/\|/g, " ")
    .replace(/(\*{1,3}|_{1,3}|~~|`+|\$\$?)/g, "");
}

export function countDocument(markdown: string): DocStats {
  const text = plainText(markdown);
  const cjk = text.match(CJK)?.length ?? 0;
  const latin = text.replace(CJK, " ").match(LATIN_WORD)?.length ?? 0;
  const words = cjk + latin;
  const characters = text.replace(/\s/g, "").length;
  const lines = markdown === "" ? 0 : markdown.split("\n").length - (markdown.endsWith("\n") ? 1 : 0);
  const minutes = words ? Math.max(1, Math.round(latin / LATIN_WPM + cjk / CJK_CPM)) : 0;
  return { words, characters, lines, minutes };
}
