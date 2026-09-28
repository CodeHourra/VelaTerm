import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const handlers = vi.hoisted(() => ({
  native: null as null | ((payload: { session: string; state: string }) => void),
  socket: null as null | ((state: string, attempts: number) => void),
  unlisten: vi.fn(),
}));
vi.mock("../ipc/transport", () => ({
  isTauri: false, isRemoteWindow: true, remoteSshSession: "wsl-test", remoteConnectionKind: "wsl",
  emitNative: vi.fn().mockResolvedValue(undefined),
  listenNative: vi.fn(async (_event, callback) => { handlers.native = callback; return handlers.unlisten; }),
}));
vi.mock("../ipc/wsClient", () => ({ wsClient: {
  onConnState: vi.fn(callback => { handlers.socket = callback; return () => {}; }),
  reconnectNow: vi.fn(), forceReconnect: vi.fn(),
} }));

import { emitNative, listenNative } from "../ipc/transport";
import { wsClient } from "../ipc/wsClient";
import { setLang } from "../i18n";
import { ConnectionBanner } from "./ConnectionBanner";

beforeEach(() => { setLang("en"); vi.clearAllMocks(); handlers.native = null; handlers.socket = null; });
afterEach(cleanup);

it("recovers its WSL service after repeated socket failures and filters other workspaces", async () => {
  const view = render(<ConnectionBanner />);
  await act(async () => {});
  expect(listenNative).toHaveBeenCalledWith("wsl://connection-state", expect.any(Function));
  act(() => handlers.native?.({ session: "other-workspace", state: "down" }));
  expect(screen.queryByRole("button")).toBeNull();
  act(() => handlers.socket?.("offline", 1));
  expect(screen.queryByRole("button")).toBeNull();
  act(() => handlers.socket?.("offline", 2));
  fireEvent.click(screen.getByRole("button", { name: "Reconnect now" }));
  expect(emitNative).toHaveBeenCalledWith("vlx://wsl-reconnect", { session: "wsl-test" });
  expect(wsClient.reconnectNow).toHaveBeenCalledOnce();
  act(() => handlers.native?.({ session: "wsl-test", state: "down" }));
  expect(screen.getByText(/The WSL workspace is unavailable/)).toBeTruthy();
  act(() => handlers.native?.({ session: "wsl-test", state: "up" }));
  expect(wsClient.forceReconnect).toHaveBeenCalledOnce();
  act(() => handlers.socket?.("online", 0));
  expect(screen.queryByRole("button")).toBeNull();
  view.unmount();
  expect(handlers.unlisten).toHaveBeenCalledOnce();
});
