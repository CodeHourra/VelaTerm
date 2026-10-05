import { useRef } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UserMessageRail } from "./UserMessageRail";

let width = 800;
beforeEach(() => {
  width = 800;
  vi.useFakeTimers();
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(500);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return { x: 0, y: 0, top: 0, left: 0, width, height: 500, right: width, bottom: 500, toJSON: () => ({}) };
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

function Reader({ select = vi.fn(), count = 3 }: { select?: (id: string) => void; count?: number }) {
  const scroll = useRef<HTMLDivElement>(null);
  const items = Array.from({ length: count }, (_, index) => ({ id: `u${index}`, text: `Question ${index + 1}`, hasImages: false, index }));
  return <><input aria-label="Draft" /><div ref={scroll}>{items.map(item => <div key={item.id} data-message-id={item.id}>{item.text}</div>)}</div>
    <UserMessageRail items={items} order={items.map(item => item.id)} scrollRef={scroll} onSelect={select} /></>;
}

it("previews on hover without taking composer focus, and supports keyboard navigation with focus restoration", () => {
  const select = vi.fn();
  render(<Reader select={select} />);
  const draft = screen.getByLabelText("Draft");
  draft.focus();
  const trigger = screen.getByRole("button", { name: "Your messages" });
  fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(document.activeElement).toBe(draft);
  fireEvent.keyDown(draft, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  expect(document.activeElement?.textContent).toContain("Question 1");
  fireEvent.keyDown(document.activeElement!, { key: "End" });
  expect(document.activeElement?.textContent).toContain("Question 3");
  fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
  expect(document.activeElement?.textContent).toContain("Question 2");
  fireEvent.click(document.activeElement!);
  expect(select).toHaveBeenCalledWith("u1");
  expect(document.activeElement).toBe(trigger);
  fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(trigger);
  fireEvent.keyDown(document.activeElement!, { key: "Tab" });
  expect(document.activeElement).toBe(trigger);
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(trigger);
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(document.activeElement).toBe(trigger);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("hides navigation in narrow panes and conversations with fewer than three user messages", async () => {
  const { rerender } = render(<Reader />);
  fireEvent.click(screen.getByRole("button", { name: "Your messages" }));
  width = 400;
  fireEvent(window, new Event("resize"));
  await act(async () => vi.advanceTimersByTimeAsync(121));
  expect(screen.queryByRole("button", { name: "Your messages" })).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
  width = 800;
  rerender(<Reader count={2} />);
  expect(screen.queryByRole("button", { name: "Your messages" })).toBeNull();
});

it("marks the newly located user message when the preceding row overlaps the inset by a fractional pixel", () => {
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
    const first = this.dataset.messageId === "u0";
    const second = this.dataset.messageId === "u1";
    const top = first ? -100 : second ? 12.1 : this.dataset.messageId ? 200 : 0;
    const bottom = first ? 12.1 : second ? 180 : this.dataset.messageId ? 700 : 500;
    return { x: 0, y: top, top, left: 0, width, height: bottom - top, right: width, bottom, toJSON: () => ({}) };
  });
  render(<Reader />);
  expect(document.querySelector(".sv-message-rail .active")?.getAttribute("data-rail-tick")).toBe("u1");
});
