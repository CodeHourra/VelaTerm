import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useUserMessageJump } from "./useUserMessageJump";
import type { UserMessageItem } from "./userMessageRailItems";

const item = (id: string, index: number | null): UserMessageItem => ({ id, index, text: id, hasImages: false });
const options = { sessionKey: "s", enabled: true, hasMore: true, failed: "Load failed", unavailable: "Unavailable" };

it("pages until the requested message has rendered, then locates it", async () => {
  let release!: (progress: boolean) => void;
  const loadEarlier = vi.fn(() => new Promise<boolean>(resolve => { release = resolve; }));
  const locate = vi.fn(async (_id: string, _signal: AbortSignal) => true);
  const { result, rerender } = renderHook(({ items }) => useUserMessageJump({ ...options, items, loadEarlier, locate }), {
    initialProps: { items: [item("old", null), item("recent", 0)] },
  });
  act(() => result.current.select("old"));
  expect(result.current.pendingId).toBe("old");
  expect(locate).not.toHaveBeenCalled();
  rerender({ items: [item("old", 0), item("recent", 2)] });
  await act(async () => release(true));
  await waitFor(() => expect(result.current.pendingId).toBeNull());
  expect(locate.mock.calls[0][0]).toBe("old");
  expect(loadEarlier).toHaveBeenCalledTimes(1);
});

it("lets a newer selection win and cancels a pending jump without a late scroll", async () => {
  let release!: (progress: boolean) => void;
  const loadEarlier = vi.fn(() => new Promise<boolean>(resolve => { release = resolve; }));
  const locate = vi.fn(async (_id: string, _signal: AbortSignal) => true);
  const { result, rerender } = renderHook(({ items }) => useUserMessageJump({ ...options, items, loadEarlier, locate }), {
    initialProps: { items: [item("old", null), item("recent", 0)] },
  });
  act(() => result.current.select("old"));
  act(() => result.current.select("recent"));
  await waitFor(() => expect(result.current.pendingId).toBeNull());
  await act(async () => release(true));
  expect(locate.mock.calls.map(call => call[0])).toEqual(["recent"]);
  act(() => result.current.select("old"));
  act(() => result.current.cancel());
  rerender({ items: [item("old", 0), item("recent", 2)] });
  await act(async () => release(true));
  expect(locate.mock.calls.map(call => call[0])).toEqual(["recent"]);
});

it("stops on a failed page and supports retry, while session changes cancel stale requests", async () => {
  const loadEarlier = vi.fn(async () => false);
  const locate = vi.fn(async (_id: string, _signal: AbortSignal) => true);
  const { result, rerender } = renderHook(({ sessionKey, items }) => useUserMessageJump({ ...options, sessionKey, items, loadEarlier, locate }), {
    initialProps: { sessionKey: "s", items: [item("old", null)] },
  });
  act(() => result.current.select("old"));
  await waitFor(() => expect(result.current.error).toBe("Load failed"));
  expect(loadEarlier).toHaveBeenCalledTimes(1);
  rerender({ sessionKey: "s", items: [item("old", 0)] });
  act(() => result.current.select("old"));
  await waitFor(() => expect(result.current.pendingId).toBeNull());
  expect(result.current.error).toBeNull();
  let release!: (progress: boolean) => void;
  loadEarlier.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  rerender({ sessionKey: "s", items: [item("old", null)] });
  act(() => result.current.select("old"));
  rerender({ sessionKey: "different", items: [item("other", 0)] });
  await act(async () => release(true));
  expect(result.current.pendingId).toBeNull();
  expect(locate).toHaveBeenCalledTimes(1);
});
