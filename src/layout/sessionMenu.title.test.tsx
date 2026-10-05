import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../types";

const mocks = vi.hoisted(() => ({ rename: vi.fn(), options: vi.fn() }));
const state = vi.hoisted(() => new Proxy({
  sessions: [] as Session[], projects: [], groups: [], agentPresets: [], agentDefaults: {},
  runtimes: {}, paneTrees: {}, sidebarTreeViews: [], ephemeralSessions: {}, openTabs: [], liveTabs: [],
}, { get: (target, key) => key in target ? target[key as keyof typeof target] : vi.fn() }));
vi.mock("../store/termStore", () => ({
  useTermStore: Object.assign((select: (s: typeof state) => unknown) => select(state), { getState: () => state }),
}));
vi.mock("../ipc/tree", () => ({ renameSessionWithAgent: mocks.rename, sessionTitleOptions: mocks.options }));
vi.mock("../ipc/commands", async importOriginal => ({
  ...await importOriginal<object>(),
  listShells: vi.fn().mockResolvedValue([]),
  gitbashStatus: vi.fn().mockResolvedValue(null),
}));
vi.mock("../hooks/useGitBranch", () => ({
  isWorktreeGone: () => false, peekGitBranchInfo: () => null, prefetchGitBranchInfo: vi.fn(), invalidateGitBranch: vi.fn(),
}));
vi.mock("../ipc/events", async importOriginal => ({
  ...await importOriginal<object>(), onGitbashDownloadDone: () => Promise.resolve(() => {}),
}));
vi.mock("../i18n", () => ({ t: (key: string) => key, useT: () => (key: string) => key }));

import { useSessionMenu } from "./sessionMenu";
import { SmartRenameRoute } from "./SmartRename/SmartRenameRoute";
import { readSmartRenameRoute } from "./SmartRename/navigation";

function session(kind: Session["kind"] = "claude", agentSessionId: string | null = "native-id"): Session {
  return { id: "session", projectId: "project", groupId: null, name: "Existing title", kind,
    agentSessionId, shell: null, cwd: null, envJson: null, initCmd: null, hotkey: null,
    parentSessionId: null, collapsed: false, worktreePath: null, sortOrder: 0, createdAt: 0 };
}
function titleItem(menu: ReturnType<typeof useSessionMenu>, s: Session) {
  return menu.buildSessionItems({ kind: "session", id: s.id, name: s.name, projectId: s.projectId, groupId: s.groupId ?? null })
    .find(item => item.label.startsWith("sessionTitle."));
}
beforeEach(() => {
  state.sessions = [session()]; mocks.rename.mockReset(); mocks.options.mockReset();
  window.history.replaceState(null, "", "/");
});
afterEach(cleanup);

describe("agent-generated session titles", () => {
  it("appears for recorded agent sessions in the shared sidebar/tab menu", () => {
    const { result } = renderHook(useSessionMenu);
    expect(titleItem(result.current, state.sessions[0])?.disabled).toBe(false);
    state.sessions = [session("claude", null)];
    const empty = renderHook(useSessionMenu);
    expect(titleItem(empty.result.current, state.sessions[0])?.disabled).toBe(true);
    for (const kind of ["terminal", "browser"] as const) {
      state.sessions = [session(kind)];
      const excluded = renderHook(useSessionMenu);
      expect(titleItem(excluded.result.current, state.sessions[0])).toBeUndefined();
    }
  });

  it("shows progress, suppresses duplicate clicks and leaves title persistence to the backend", async () => {
    let finish!: (value: { title: string; agent: string }) => void;
    mocks.rename.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const { result } = renderHook(useSessionMenu);
    const item = titleItem(result.current, state.sessions[0])!;
    act(() => { item.onClick?.({} as React.MouseEvent); item.onClick?.({} as React.MouseEvent); });
    expect(mocks.rename).toHaveBeenCalledTimes(1);
    expect(mocks.rename).toHaveBeenCalledWith("session");
    expect(titleItem(result.current, state.sessions[0])?.disabled).toBe(true);
    const view = render(result.current.dialogs);
    expect(screen.getByRole("status").textContent).toContain("sessionTitle.generating");
    await act(async () => { finish({ title: "Generated", agent: "claude" }); });
    view.rerender(result.current.dialogs);
    expect(screen.queryByRole("status")).toBeNull();
    expect(state.sessions[0].name).toBe("Existing title");
  });

  it("shows a localized error while keeping the original title", async () => {
    mocks.rename.mockRejectedValue(new Error("session_title:changed"));
    const { result } = renderHook(useSessionMenu);
    act(() => titleItem(result.current, state.sessions[0])!.onClick?.({} as React.MouseEvent));
    await waitFor(() => expect(titleItem(result.current, state.sessions[0])?.disabled).toBe(false));
    render(result.current.dialogs);
    expect(screen.getByRole("alertdialog").textContent).toContain("sessionTitle.changed");
    expect(state.sessions[0].name).toBe("Existing title");
  });

  it("opens the chooser only after the current agent becomes unavailable", async () => {
    mocks.rename.mockRejectedValue(new Error("session_title:agent_unavailable"));
    const { result } = renderHook(useSessionMenu);
    act(() => titleItem(result.current, state.sessions[0])!.onClick?.({} as React.MouseEvent));
    await waitFor(() => expect(readSmartRenameRoute()?.sessionId).toBe("session"));
    expect(mocks.rename).toHaveBeenCalledTimes(1);
    expect(mocks.rename).toHaveBeenCalledWith("session");
    expect(new URL(window.location.href).searchParams.get("smartRenameAgent")).toBeNull();
  });

  it("restores a chooser without generating and retries with the explicitly selected agent", async () => {
    const spec = { supportsPlanExecute: true, supportsReferSummary: true, acceptsTask: true, effortFlag: null, effortLevels: [] };
    mocks.options.mockResolvedValue({ agents: [
      { ...spec, id: "claude", label: "Claude", available: false },
      { ...spec, id: "codex", label: "Codex", available: true },
    ] });
    mocks.rename.mockResolvedValue({ title: "Generated", agent: "codex" });
    window.history.replaceState(null, "", "/?smartRename=session");
    render(<SmartRenameRoute />);
    const trigger = await screen.findByRole("combobox", { name: "orch.agentLabel" });
    expect(mocks.rename).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "common.rename" }).hasAttribute("disabled")).toBe(true);
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(screen.getByRole("option", { name: /Claude/ }).getAttribute("aria-disabled")).toBe("true");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(new URL(window.location.href).searchParams.get("smartRenameAgent")).toBe("codex");
    expect(mocks.rename).not.toHaveBeenCalled();
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(readSmartRenameRoute()?.sessionId).toBe("session");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(mocks.rename).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "common.rename" }));
    await waitFor(() => expect(readSmartRenameRoute()).toBeNull());
    expect(mocks.rename).toHaveBeenCalledWith("session", "codex");
  });
});
