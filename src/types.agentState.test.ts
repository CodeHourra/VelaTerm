//! State categories behind the sidebar dots, the status filters, and the status bar counts.

import { describe, expect, it } from "vitest";
import { countByAgentState, matchesAgentState, type SessionRuntime } from "./types";

const runtime = (agentState: SessionRuntime["agentState"]): SessionRuntime =>
  ({ status: "running", agent: "claude", agentState }) as SessionRuntime;

describe("background agent state", () => {
  it("counts as background only once its reply has been read", () => {
    expect(matchesAgentState("background", "background", false)).toBe(true);
    expect(matchesAgentState("background", "background", true)).toBe(false);
    expect(matchesAgentState("asking", "background", true)).toBe(true);
    expect(matchesAgentState("working", "background", false)).toBe(false);
    expect(matchesAgentState("waiting", "background", false)).toBe(false);
  });

  it("puts each session in exactly one count", () => {
    const sessions = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    const runtimes = {
      a: runtime("background"),
      b: runtime("background"),
      c: runtime("working"),
      d: runtime("waiting"),
    };
    expect(countByAgentState(sessions, runtimes, { b: 1 })).toEqual({
      working: 1,
      asking: 1,
      waiting: 1,
      background: 1,
    });
  });
});
