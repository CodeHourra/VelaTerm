import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Backdrop } from "../../../components/Backdrop";
import Icons from "../../../components/Icons";
import { SELECT_PANEL } from "../../../components/Select";
import { useT } from "../../../i18n";
import { useUserMessageRail } from "./useUserMessageRail";
import type { UserMessageItem } from "./userMessageRailItems";
import "./user-message-rail.css";

export function UserMessageRail({ items, order, scrollRef, enabled = true, pendingId, error, onSelect, onCancel }: {
  items: readonly UserMessageItem[];
  order: readonly string[];
  scrollRef: RefObject<HTMLElement | null>;
  enabled?: boolean;
  pendingId?: string | null;
  error?: string | null;
  onSelect: (id: string) => void;
  onCancel?: () => void;
}) {
  const t = useT();
  const rail = useUserMessageRail(items, order, scrollRef, enabled);
  const [mode, setMode] = useState<"hover" | "interactive" | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const previousPending = useRef(pendingId);
  const lastSelection = useRef<string | null>(null);
  const blockHover = useRef(false);
  const panelId = useId();
  const [position, setPosition] = useState({ left: 0, top: 0, width: 248, maxHeight: 254 });
  const preview = (item: UserMessageItem) => item.text || t(item.hasImages ? "chat.rail.imageMessage" : "chat.rail.emptyMessage");
  const close = (restore = mode === "interactive") => {
    blockHover.current = true;
    clearTimeout(leaveTimer.current);
    setMode(null);
    if (restore) trigger.current?.focus({ preventScroll: true });
  };
  const enter = () => clearTimeout(leaveTimer.current);
  const leave = () => {
    clearTimeout(leaveTimer.current);
    if (mode === "hover") leaveTimer.current = setTimeout(() => setMode(null), 180);
  };

  useEffect(() => () => clearTimeout(leaveTimer.current), []);
  useEffect(() => {
    if (mode !== "hover") return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); blockHover.current = true; onCancel?.(); setMode(null); }
    };
    document.addEventListener("keydown", dismiss, true);
    return () => document.removeEventListener("keydown", dismiss, true);
  }, [mode, onCancel]);
  useEffect(() => { if (!rail.visible) setMode(null); }, [rail.visible]);
  useEffect(() => {
    if (previousPending.current && !pendingId && !error) close();
    previousPending.current = pendingId;
  }, [pendingId, error]);

  useLayoutEffect(() => {
    if (!mode) return;
    const buttons = list.current?.querySelectorAll<HTMLButtonElement>("[data-rail-message]");
    const current = Array.from(buttons ?? []).find(button => button.dataset.railMessage === (pendingId ?? rail.activeId)) ?? buttons?.[0];
    if (current && list.current) list.current.scrollTop = Math.max(0, current.offsetTop - list.current.offsetTop - list.current.clientHeight / 2 + current.offsetHeight / 2);
  }, [mode, rail.activeId, pendingId, items]);

  useLayoutEffect(() => {
    if (!mode) return;
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      if (!anchor) return;
      const width = Math.min(248, window.innerWidth - 24);
      const maxHeight = Math.min(254, window.innerHeight - 24);
      const bounds = panel.current?.getBoundingClientRect();
      const tick = trigger.current?.querySelector(".active")?.getBoundingClientRect();
      const current = list.current?.querySelector("[aria-current]")?.getBoundingClientRect();
      const viewport = list.current?.getBoundingClientRect();
      const height = bounds?.height ?? maxHeight;
      const center = tick ? tick.top + tick.height / 2 : anchor.top + anchor.height / 2;
      const offset = bounds && current && viewport && current.top >= viewport.top && current.bottom <= viewport.bottom
        ? current.top + current.height / 2 - bounds.top : height / 2;
      const next = { width, maxHeight, left: Math.max(12, anchor.left - width - 8), top: Math.max(12, Math.min(center - offset, window.innerHeight - height - 12)) };
      setPosition(previous => Object.keys(next).every(key => previous[key as keyof typeof next] === next[key as keyof typeof next]) ? previous : next);
    };
    const followScroll = (event: Event) => {
      if (event.target instanceof Node && panel.current?.contains(event.target)) return;
      place();
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", followScroll, true);
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    if (panel.current) resize?.observe(panel.current);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", followScroll, true); resize?.disconnect(); };
  }, [mode, rail.activeId, pendingId, error]);
  useLayoutEffect(() => {
    if (mode !== "interactive") return;
    const buttons = list.current?.querySelectorAll<HTMLButtonElement>("[data-rail-message]");
    const current = Array.from(buttons ?? []).find(button => button.dataset.railMessage === rail.activeId) ?? buttons?.[0];
    current?.focus({ preventScroll: true });
  }, [mode]);

  if (!rail.visible) return null;
  return <>
    <button ref={trigger} type="button" className="sv-message-rail" aria-label={t("chat.rail.title")} aria-haspopup="dialog" aria-expanded={Boolean(mode)} aria-controls={mode ? panelId : undefined}
      onPointerEnter={event => { enter(); if (event.pointerType !== "touch" && !mode && !blockHover.current) setMode("hover"); }}
      onPointerLeave={() => { blockHover.current = false; leave(); }}
      onPointerMove={event => {
        if ((event.movementX || event.movementY) && event.pointerType !== "touch" && !mode) { blockHover.current = false; setMode("hover"); }
      }}
      onClick={() => { enter(); setMode(mode === "interactive" ? null : "interactive"); }}
      onKeyDown={event => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setMode("interactive"); } }}
      onWheel={event => { if (scrollRef.current) { scrollRef.current.scrollTop += event.deltaY; onCancel?.(); } }}>
      {rail.ticks.map(item => <span key={item.id} className={item.id === rail.activeId ? "active" : undefined} data-rail-tick={item.id} aria-hidden="true" />)}
    </button>
    {mode && createPortal(<Backdrop dim={false} center={false} interactive={mode === "interactive"} onClose={() => { onCancel?.(); close(); }}>
      <div ref={panel} id={panelId} className="sv-message-menu" role="dialog" aria-label={t("chat.rail.title")} style={{ ...SELECT_PANEL, ...position, padding: 8, borderRadius: 4, borderColor: "var(--border)", position: "fixed", overflowY: "hidden", pointerEvents: "auto", top: position.top }}
        onPointerEnter={enter} onPointerLeave={leave}
        onKeyDown={event => {
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCancel?.(); close(); return; }
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            const buttons = Array.from(list.current?.querySelectorAll<HTMLButtonElement>("[data-rail-message]") ?? []);
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
            event.preventDefault(); buttons[next]?.focus();
          }
          if (event.key === "Tab") { event.preventDefault(); close(); }
        }}>
        <div className="sv-message-menu-head">{t("chat.rail.title")}</div>
        <div ref={list} className="sv-message-menu-list" aria-busy={Boolean(pendingId)}>
          {items.map(item => <button key={item.id} type="button" className="sv-message-menu-item" data-rail-message={item.id} title={preview(item)} aria-current={item.id === rail.activeId ? "location" : undefined} aria-busy={item.id === pendingId || undefined}
            onMouseDown={event => { if (mode === "hover") event.preventDefault(); }}
            onClick={() => { lastSelection.current = item.id; onSelect(item.id); if (item.index !== null) close(); }}>
            <span className="sv-message-menu-preview">{preview(item)}</span>
            {item.id === pendingId && <Icons.clock size={12} />}
          </button>)}
        </div>
        {pendingId && <div className="sv-message-menu-status" role="status">{t("chat.rail.loading")}<button type="button" className="vlx-btn" onClick={onCancel}>{t("common.cancel")}</button></div>}
        {error && <div className="sv-message-menu-status" role="alert">{error}
          {lastSelection.current && <button type="button" className="vlx-btn" onClick={() => onSelect(lastSelection.current!)}>{t("common.retry")}</button>}
        </div>}
      </div>
    </Backdrop>, document.body)}
  </>;
}
