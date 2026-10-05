import type { ChatRow, ChatUserMessage } from "../../../ipc/chat";

export interface UserMessageItem extends ChatUserMessage {
  /** Index in the displayed list; null until the older page containing this message loads. */
  index: number | null;
}

export function userMessagePreview(text: string): string {
  const characters: string[] = [];
  for (const character of text.replace(/\s+/gu, " ").trim()) {
    if (characters.length === 240) break;
    characters.push(character);
  }
  return characters.join("");
}

export function userMessageItems(rows: readonly ChatRow[], outline: readonly ChatUserMessage[], order: readonly string[], previous: UserMessageItem[] = []): UserMessageItem[] {
  const indices = new Map(order.map((id, index) => [id, index]));
  const messages = new Map(outline.map(item => [item.id, item]));
  for (const row of rows) {
    if (row.kind === "user") messages.set(row.id, {
      id: row.id, text: userMessagePreview(row.text), hasImages: Boolean(row.images?.length),
    });
  }
  const old = new Map(previous.map(item => [item.id, item]));
  const next = [...messages.values()].map(item => {
    const index = indices.get(item.id) ?? null;
    const cached = old.get(item.id);
    return cached && cached.text === item.text && cached.hasImages === item.hasImages && cached.index === index ? cached : { ...item, index };
  });
  return next.length === previous.length && next.every((item, i) => item === previous[i]) ? previous : next;
}

/** Keep both ends and the current message while limiting the rail's visual density. */
export function userMessageTicks(items: readonly UserMessageItem[], activeId: string | null): UserMessageItem[] {
  if (items.length <= 20) return [...items];
  const indices = new Set(Array.from({ length: 20 }, (_, i) => Math.round(i * (items.length - 1) / 19)));
  const active = items.findIndex(item => item.id === activeId);
  if (active >= 0 && !indices.has(active)) {
    const nearest = [...indices].filter(i => i !== 0 && i !== items.length - 1)
      .sort((a, b) => Math.abs(a - active) - Math.abs(b - active))[0];
    indices.delete(nearest);
    indices.add(active);
  }
  return [...indices].sort((a, b) => a - b).map(i => items[i]);
}

/** Assistant/tool rows belong to the most recent user message before the visible row. */
export function activeUserMessage(items: readonly UserMessageItem[], visibleIndex: number): string | null {
  let active: string | null = null;
  for (const item of items) {
    if (item.index !== null && item.index <= visibleIndex) active = item.id;
  }
  if (active) return active;
  // A recent page can begin halfway through a reply, before its user row has been loaded.
  const firstLoaded = items.findIndex(item => item.index !== null);
  return items[(firstLoaded < 0 ? items.length : firstLoaded) - 1]?.id ?? null;
}
