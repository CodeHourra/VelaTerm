//! Screenshot hotkey accelerators in the backend's `Ctrl+Alt+Shift+Cmd+Key` form.
//!
//! Unlike the in-app shortcuts in shortcutRegistry (which only fire while VelaTerm has focus), this
//! hotkey is registered with the operating system and fires in every application. It therefore
//! stores the literal modifiers instead of the cross-platform "mod", and allows digits and F1–F12.
//! `Cmd` is the Command key on macOS and the Windows key elsewhere.

import {
  DEFAULT_BINDINGS,
  IS_MAC,
  effectiveCombo,
  type ShortcutAction,
} from "../hooks/shortcutRegistry";

const MODIFIERS = ["Ctrl", "Alt", "Shift", "Cmd"] as const;

const isFunctionKey = (key: string) => /^F([1-9]|1[0-2])$/.test(key);

/** Main key from a physical key code: letters, digits, or F1–F12. */
function mainKey(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1];
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return digit[1];
  return isFunctionKey(code) ? code : null;
}

/**
 * Accelerator for a key press while recording, or null to keep waiting. Letters and digits need Ctrl,
 * Alt, or Cmd: with no modifier or with Shift alone, the hotkey would swallow ordinary typing in
 * every application. Function keys may stand alone.
 */
export function acceleratorFromEvent(e: KeyboardEvent): string | null {
  const key = mainKey(e.code);
  if (!key) return null;
  if (!(e.ctrlKey || e.altKey || e.metaKey) && !isFunctionKey(key)) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Cmd");
  parts.push(key);
  return parts.join("+");
}

interface Parsed {
  mods: Set<string>;
  key: string;
}

function parse(accel: string): Parsed {
  const tokens = accel.split("+").filter(Boolean);
  return { mods: new Set(tokens.slice(0, -1)), key: tokens[tokens.length - 1] ?? "" };
}

/** Canonical modifier order so equal chords compare equal as strings. */
function canonical(p: Parsed): string {
  return [...MODIFIERS.filter((m) => p.mods.has(m)), p.key].join("+");
}

/** Display form: macOS symbols in Apple's order (⌃⌥⇧⌘S), elsewhere "Ctrl+Alt+Shift+Win+S". */
export function formatAccelerator(accel: string): string {
  const p = parse(accel);
  if (!p.key) return "";
  if (IS_MAC) {
    const symbols: Record<string, string> = { Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Cmd: "⌘" };
    return MODIFIERS.filter((m) => p.mods.has(m)).map((m) => symbols[m]).join("") + p.key;
  }
  const names: Record<string, string> = { Ctrl: "Ctrl", Alt: "Alt", Shift: "Shift", Cmd: "Win" };
  return [...MODIFIERS.filter((m) => p.mods.has(m)).map((m) => names[m]), p.key].join("+");
}

/** Desktop in-app combo ("mod+shift+d", "cmd+d") as an accelerator. */
function comboToAccelerator(combo: string): string {
  const tokens = combo.split("+");
  const mods = new Set<string>();
  for (const t of tokens.slice(0, -1)) {
    if (t === "mod") mods.add(IS_MAC ? "Cmd" : "Ctrl");
    else if (t === "cmd") mods.add("Cmd");
    else if (t === "shift") mods.add("Shift");
    else if (t === "alt") mods.add("Alt");
  }
  return canonical({ mods, key: (tokens[tokens.length - 1] ?? "").toUpperCase() });
}

/** Whether an in-app combo and an accelerator describe the same key chord. */
export function sameChord(inAppCombo: string, accel: string): boolean {
  return !!accel && comboToAccelerator(inAppCombo) === canonical(parse(accel));
}

/**
 * The in-app action this accelerator would take over, or "tabs" for the fixed Cmd/Ctrl+1–9 tab
 * switching. A global hotkey is consumed by the system before VelaTerm sees the key.
 */
export function inAppConflict(
  accel: string,
  overrides: Partial<Record<ShortcutAction, string>>,
): ShortcutAction | "tabs" | null {
  const p = parse(accel);
  const target = canonical(p);
  for (const action of Object.keys(DEFAULT_BINDINGS) as ShortcutAction[]) {
    if (comboToAccelerator(effectiveCombo(action, overrides)) === target) return action;
  }
  const primary = IS_MAC ? "Cmd" : "Ctrl";
  if (/^[1-9]$/.test(p.key) && p.mods.size === 1 && p.mods.has(primary)) return "tabs";
  return null;
}
