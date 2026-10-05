import { describe, expect, it } from "vitest";
import { IS_MAC } from "../hooks/shortcutRegistry";
import { acceleratorFromEvent, formatAccelerator, inAppConflict, sameChord } from "./accelerator";

const key = (code: string, mods: Partial<Pick<KeyboardEvent, "ctrlKey" | "altKey" | "shiftKey" | "metaKey">> = {}) =>
  new KeyboardEvent("keydown", { code, ...mods });

describe("acceleratorFromEvent", () => {
  it("records modifiers in canonical order", () => {
    expect(acceleratorFromEvent(key("KeyS", { metaKey: true, ctrlKey: true }))).toBe("Ctrl+Cmd+S");
    expect(acceleratorFromEvent(key("Digit4", { shiftKey: true, altKey: true }))).toBe("Alt+Shift+4");
  });

  // Bare letters or Shift+letter would swallow ordinary typing in every application.
  it("rejects chords that would steal typing", () => {
    expect(acceleratorFromEvent(key("KeyA"))).toBeNull();
    expect(acceleratorFromEvent(key("KeyA", { shiftKey: true }))).toBeNull();
  });

  it("allows bare function keys and ignores modifier-only presses", () => {
    expect(acceleratorFromEvent(key("F1"))).toBe("F1");
    expect(acceleratorFromEvent(key("ShiftLeft", { shiftKey: true }))).toBeNull();
  });
});

describe("formatAccelerator", () => {
  it("formats per platform", () => {
    expect(formatAccelerator("Ctrl+Cmd+S")).toBe(IS_MAC ? "⌃⌘S" : "Ctrl+Win+S");
    expect(formatAccelerator("")).toBe("");
  });
});

describe("conflicts with in-app shortcuts", () => {
  const primary = IS_MAC ? "Cmd" : "Ctrl";

  it("detects tab switching", () => {
    expect(inAppConflict(`${primary}+3`, {})).toBe("tabs");
  });

  it("detects an overridden in-app binding regardless of modifier order", () => {
    expect(inAppConflict(`Shift+${primary}+K`, { search: "mod+shift+k" })).toBe("search");
    expect(sameChord("mod+shift+k", `Shift+${primary}+K`)).toBe(true);
  });

  it("does not flag the default screenshot keys", () => {
    expect(inAppConflict("Ctrl+Cmd+S", {})).toBeNull();
    expect(sameChord("mod+s", "")).toBe(false);
  });
});
