import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContextMenu } from "./ContextMenu";

describe("ContextMenu viewport clamping", () => {
  afterEach(() => {
    cleanup(); vi.restoreAllMocks();
  });

  it("measures the real panel and moves a right-edge menu fully into view", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 172,
      height: 280,
      x: 450,
      y: 20,
      top: 20,
      right: 622,
      bottom: 300,
      left: 450,
      toJSON: () => ({}),
    });
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(520);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(500);

    render(
      <ContextMenu
        x={450}
        y={20}
        items={[{ label: "New Browser Page", onClick: () => {} }]}
        onClose={() => {}}
      />,
    );

    const item = screen.getByText("New Browser Page");
    const panel = item.closest("[role=menu]");
    const positioner = panel?.parentElement;
    await waitFor(() => expect((positioner as HTMLElement)?.style.left).toBe("340px"));
  });
});


describe("ContextMenu keyboard and selection behavior", () => {
  beforeEach(() => { HTMLElement.prototype.scrollIntoView = vi.fn(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });
  const key = (name: string) => fireEvent.keyDown(window, { key: name });
  async function focused(label: string) { await waitFor(() => expect(document.activeElement?.closest(".menu-item")?.textContent).toContain(label)); }
  it("skips disabled entries, traverses submenus and returns focus to the invoker", async () => {
    const action = vi.fn(); const close = vi.fn();
    const trigger = document.createElement("button"); document.body.append(trigger); trigger.focus(); expect(document.activeElement).toBe(trigger);
    render(<ContextMenu x={10} y={10} onClose={close} items={[
      { label: "Disabled", disabled: true }, { label: "Alpha", onClick: action }, { label: "", separator: true },
      { label: "Folder", submenu: [{ label: "Hidden", disabled: true }, { label: "Child", onClick: action }] },
      { label: "Omega", onClick: action },
    ]} />);
    expect(document.activeElement).toBe(trigger);
    key("ArrowDown"); await focused("Alpha"); key("ArrowDown"); await focused("Folder");
    key("ArrowRight"); await focused("Child"); key("ArrowLeft"); await focused("Folder");
    key("End"); await focused("Omega"); key("Home"); await focused("Alpha");
    key("o"); await focused("Omega"); key("Enter");
    expect(action).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce(); expect(document.activeElement).toBe(trigger); trigger.remove();
  });
  it("closes a submenu first on Escape, supports Space and allows Tab to dismiss", async () => {
    const close = vi.fn();
    render(<ContextMenu x={10} y={10} onClose={close} items={[{ label: "Parent", submenu: [{ label: "Child" }] }]} />);
    key("ArrowDown"); await focused("Parent"); key(" "); await focused("Child");
    key("Escape"); await focused("Parent"); expect(close).not.toHaveBeenCalled();
    key("Tab"); expect(close).toHaveBeenCalledOnce();
  });
  it("preserves the editor selection when opening and clicking a pointer menu", () => {
    const editor = document.createElement("div"); editor.contentEditable = "true"; editor.tabIndex = 0; editor.textContent = "Keep this selection"; document.body.append(editor); editor.focus();
    const range = document.createRange(); range.selectNodeContents(editor); window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range);
    const action = vi.fn(() => expect(window.getSelection()?.toString()).toBe("Keep this selection"));
    render(<ContextMenu x={10} y={10} onClose={() => {}} items={[{ label: "Copy", onClick: action, shortcut: "Ctrl+C" }]} />);
    const item = screen.getByRole("menuitem"); expect(fireEvent.mouseDown(item)).toBe(false); fireEvent.click(item);
    expect(action).toHaveBeenCalledOnce(); expect(document.activeElement).toBe(editor); editor.remove();
  });
});
