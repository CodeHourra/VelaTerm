//! Shared Vela Skills state for the status-bar prompt, its details dialog, and the Settings install
//! button. Checking once at startup only lights up a status-bar segment; the dialog opens when the user
//! clicks it, mirroring the update prompt. "Don't remind me again" hides the segment for good, while
//! Settings keeps offering installation.

import { useSyncExternalStore } from "react";

import { installSpawnSkills, spawnSkillsInstalled } from "./commands";

/** Set by "Don't remind me again"; it silences only the status-bar prompt, not the Settings entry. */
const DISMISSED_KEY = "vlx-vela-skills-prompt-dismissed";

function loadDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export interface VelaSkillsState {
  /** null until the first check finishes, so nothing flashes while it is pending. */
  installed: boolean | null;
  dismissed: boolean;
  modalOpen: boolean;
  installing: boolean;
  error: string | null;
}

let state: VelaSkillsState = {
  installed: null,
  dismissed: loadDismissed(),
  modalOpen: false,
  installing: false,
  error: null,
};
const listeners = new Set<() => void>();

function setState(patch: Partial<VelaSkillsState>) {
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useVelaSkillsState(): VelaSkillsState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

/** Refresh the installed flag; a failed check keeps the prompt hidden rather than nagging. */
export async function checkVelaSkills(): Promise<boolean | null> {
  try {
    const installed = await spawnSkillsInstalled();
    setState({ installed });
    return installed;
  } catch {
    return state.installed;
  }
}

/** Install the bundled skills. Errors are rethrown for callers that report them themselves. */
export async function installVelaSkills(): Promise<void> {
  setState({ installing: true, error: null });
  try {
    await installSpawnSkills();
    setState({ installed: true, installing: false, modalOpen: false });
  } catch (e) {
    setState({ installing: false, error: String(e) });
    throw e;
  }
}

export function openVelaSkillsModal() {
  setState({ modalOpen: true, error: null });
}

export function closeVelaSkillsModal() {
  if (!state.installing) setState({ modalOpen: false });
}

/** Stop showing the status-bar prompt on this client. */
export function dismissVelaSkillsPrompt() {
  try {
    localStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    /* Ignore unavailable localStorage; at worst the prompt returns next launch. */
  }
  setState({ dismissed: true, modalOpen: false });
}
