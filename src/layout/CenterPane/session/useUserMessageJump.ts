import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import type { UserMessageItem } from "./userMessageRailItems";

/** One cancellable navigation owns paging; a newer selection joins any page already in flight. */
export function useUserMessageJump({ items, sessionKey, enabled, hasMore, loadEarlier, locate, failed, unavailable }: {
  items: readonly UserMessageItem[];
  sessionKey: string;
  enabled: boolean;
  hasMore: boolean;
  loadEarlier: () => Promise<boolean>;
  locate: (id: string, signal: AbortSignal) => Promise<boolean>;
  failed: string;
  unavailable: string;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, commit] = useReducer((n: number) => n + 1, 0);
  const controller = useRef<AbortController | null>(null);
  const committed = useRef({ items, hasMore, loadEarlier, locate });
  const waiters = useRef(new Set<() => void>());
  useLayoutEffect(() => {
    committed.current = { items, hasMore, loadEarlier, locate };
    [...waiters.current].forEach(resolve => resolve());
  });
  const nextCommit = useCallback((signal: AbortSignal) => new Promise<void>(resolve => {
    const done = () => { waiters.current.delete(done); signal.removeEventListener("abort", done); resolve(); };
    waiters.current.add(done);
    signal.addEventListener("abort", done, { once: true });
    if (signal.aborted) done(); else commit();
  }), []);
  const cancel = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setPendingId(null);
    setError(null);
  }, []);
  useEffect(() => { cancel(); return cancel; }, [sessionKey, enabled, cancel]);

  const select = useCallback((id: string) => {
    if (!enabled) return;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setPendingId(id);
    setError(null);
    void (async () => {
      // Read the committed rows after each page. A page that makes no progress stops the loop.
      for (;;) {
        if (request.signal.aborted) return;
        const state = committed.current;
        const item = state.items.find(item => item.id === id);
        if (!item) throw new Error(unavailable);
        if (item.index !== null) {
          if (!await state.locate(id, request.signal) && !request.signal.aborted) throw new Error(unavailable);
          return;
        }
        if (!state.hasMore) throw new Error(unavailable);
        if (!await state.loadEarlier()) throw new Error(failed);
        await nextCommit(request.signal);
      }
    })().catch(reason => { if (!request.signal.aborted) setError(reason instanceof Error ? reason.message : failed); })
      .finally(() => {
        if (controller.current === request) { controller.current = null; setPendingId(null); }
      });
  }, [enabled, failed, unavailable, nextCommit]);
  return { pendingId, error, select, cancel };
}
