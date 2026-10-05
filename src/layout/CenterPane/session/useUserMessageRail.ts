import { useLayoutEffect, useMemo, useState, type RefObject } from "react";
import { activeUserMessage, userMessageTicks, type UserMessageItem } from "./userMessageRailItems";

export function useUserMessageRail(items: readonly UserMessageItem[], order: readonly string[], scrollRef: RefObject<HTMLElement | null>, enabled = true) {
  const [wide, setWide] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll || !enabled) return;
    const indices = new Map(order.map((id, index) => [id, index]));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const measure = () => {
      if (!scroll.clientHeight) { setWide(false); return; }
      setWide(scroll.clientWidth >= 512);
      // Probe past the jump's 12px inset so a fractional pixel from the preceding row cannot win.
      const top = scroll.getBoundingClientRect().top + 16;
      const visible = Array.from(scroll.querySelectorAll<HTMLElement>("[data-message-id]"))
        .find(element => element.getBoundingClientRect().bottom > top);
      const index = visible ? indices.get(visible.dataset.messageId!) : undefined;
      setActiveId(index === undefined ? null : activeUserMessage(items, index));
    };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(measure, 120); };
    measure();
    scroll.addEventListener("scroll", schedule, { passive: true });
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    resize?.observe(scroll);
    window.addEventListener("resize", schedule);
    const changes = new MutationObserver(schedule);
    changes.observe(scroll, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["style"] });
    return () => {
      clearTimeout(timer);
      scroll.removeEventListener("scroll", schedule);
      resize?.disconnect();
      window.removeEventListener("resize", schedule);
      changes.disconnect();
    };
  }, [items, order, scrollRef, enabled]);

  const ticks = useMemo(() => userMessageTicks(items, activeId), [items, activeId]);
  return { activeId, ticks, visible: enabled && wide && items.length >= 3 };
}
