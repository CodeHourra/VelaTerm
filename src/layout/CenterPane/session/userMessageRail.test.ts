import { expect, it } from "vitest";
import type { ChatRow } from "../../../ipc/chat";
import { activeUserMessage, userMessageItems, userMessagePreview, userMessageTicks, type UserMessageItem } from "./userMessageRailItems";

it("keeps both endpoints and every possible active message in a bounded, ordered rail", () => {
  for (const length of [3, 20, 21, 44, 101, 1000]) {
    const items: UserMessageItem[] = Array.from({ length }, (_, index) => ({ id: String(index), text: "Prompt", hasImages: false, index }));
    for (const current of items) {
      const ticks = userMessageTicks(items, current.id);
      expect(ticks.length).toBe(Math.min(20, length));
      expect(ticks[0]).toBe(items[0]);
      expect(ticks.at(-1)).toBe(items.at(-1));
      expect(ticks).toContain(current);
      expect(new Set(ticks.map(item => item.id)).size).toBe(ticks.length);
      expect(ticks.map(item => item.index)).toEqual(ticks.map(item => item.index).sort((a, b) => a! - b!));
    }
  }
});

it("merges older outline messages, edited loaded prompts, image-only messages and new live messages", () => {
  expect([...userMessagePreview("A" + "🧭".repeat(300))].length).toBe(240);
  const rows: ChatRow[] = [
    { kind: "user", id: "b", text: "Updated\n prompt" },
    { kind: "assistant", id: "answer", text: "Answer", streaming: false },
    { kind: "user", id: "c", text: "", images: [{ attachmentId: "image", mimeType: "image/png" }] },
    { kind: "user", id: "d", text: "Newest" },
  ];
  const items = userMessageItems(rows, [
    { id: "a", text: "Earlier", hasImages: false }, { id: "b", text: "Original", hasImages: false },
  ], ["b", "answer", "c", "d"]);
  expect(items.map(item => item.id)).toEqual(["a", "b", "c", "d"]);
  expect(items[0].index).toBeNull();
  expect(items[1].text).toBe("Updated prompt");
  expect(items[2].hasImages).toBe(true);
  expect(activeUserMessage(items, 1)).toBe("b");
  expect(activeUserMessage(items, 3)).toBe("d");
  expect(activeUserMessage(items, -1)).toBe("a");
  expect(userMessageItems(rows.map(row => row.kind === "assistant" ? { ...row, text: "More streamed output" } : row), [
    { id: "a", text: "Earlier", hasImages: false }, { id: "b", text: "Original", hasImages: false },
  ], ["b", "answer", "c", "d"], items)).toBe(items);
});
