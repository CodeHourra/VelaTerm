//! Focus mode and typewriter mode. Like Typora, they are editor-wide preferences rather than
//! per-document state: every open Markdown tab follows the same switches, and they persist.

import { useSyncExternalStore } from "react";
import type { WritingModes } from "./WysiwygEditor";

const STORAGE_KEY = "vlx-doc-writing-modes";

function load(): WritingModes {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<WritingModes>;
    return { focus: saved.focus === true, typewriter: saved.typewriter === true };
  } catch {
    return { focus: false, typewriter: false };
  }
}

let modes = load();
const listeners = new Set<() => void>();

export function toggleWritingMode(mode: keyof WritingModes) {
  modes = { ...modes, [mode]: !modes[mode] };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(modes));
  } catch {
    /* Storage can be unavailable; the switch still applies for this session. */
  }
  listeners.forEach(listener => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useWritingModes(): WritingModes {
  return useSyncExternalStore(subscribe, () => modes);
}
