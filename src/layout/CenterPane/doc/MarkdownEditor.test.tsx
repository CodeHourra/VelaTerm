import * as React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownEditor, type MarkdownHandle } from "./MarkdownEditor";

const calls = vi.hoisted(() => ({
  visualFocus: vi.fn(), sourceFocus: vi.fn(), setMarkdown: vi.fn(), setText: vi.fn(), placeCaret: vi.fn(),
  visualModes: vi.fn(), sourceModes: vi.fn(), readingPosition: vi.fn(), revealAnchor: vi.fn(),
}));
vi.mock("./WysiwygEditor", () => ({
  WysiwygEditor: React.forwardRef(function Visual(props: { defaultValue: string; onReady(): void; onEdited(): void }, ref) {
    const input = React.useRef<HTMLTextAreaElement>(null);
    React.useImperativeHandle(ref, () => ({
      getMarkdown: () => input.current!.value,
      setMarkdown: (text: string) => { calls.setMarkdown(text); input.current!.value = text; },
      placeCaret: calls.placeCaret,
      focus: () => { calls.visualFocus(); input.current?.focus(); },
      setWritingModes: calls.visualModes,
      readingAnchor: () => null,
      revealAnchor: calls.revealAnchor,
    }));
    // The real editor initializes once, independently of callback identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    React.useEffect(() => props.onReady(), []);
    return <div className="docview-wysiwyg"><textarea data-testid="visual" ref={input}
      defaultValue={props.defaultValue} onChange={props.onEdited} /></div>;
  }),
}));
vi.mock("./SourceEditor", () => ({
  SourceEditor: React.forwardRef(function Source(props: { defaultValue: string; onEdited(): void }, ref) {
    const input = React.useRef<HTMLTextAreaElement>(null);
    React.useImperativeHandle(ref, () => ({
      getText: () => input.current!.value,
      setText: (text: string) => { calls.setText(text); input.current!.value = text; },
      focus: () => { calls.sourceFocus(); input.current?.focus(); },
      setWritingModes: calls.sourceModes,
      readingPosition: calls.readingPosition,
      revealPosition: vi.fn(),
    }));
    return <textarea data-testid="source" ref={input} defaultValue={props.defaultValue} onChange={props.onEdited} />;
  }),
}));

afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });
const props = { defaultValue: "original", docPath: "/tmp/example.md", onEdited: vi.fn(), onImageError: vi.fn() };

describe("Markdown writing interactions", () => {
  it("does not steal initial focus and restores the selected editor's focus after a mode switch", () => {
    const view = render(<MarkdownEditor {...props} mode="visual" />);
    expect(calls.visualFocus).not.toHaveBeenCalled();
    view.rerender(<MarkdownEditor {...props} mode="source" />);
    expect(document.activeElement).toBe(view.getByTestId("source"));
    view.rerender(<MarkdownEditor {...props} mode="compare" />);
    expect(document.activeElement).toBe(view.getByTestId("visual"));
  });

  it.each(["visual", "source"] as const)("waits for %s composition to finish before updating the companion", side => {
    vi.useFakeTimers();
    const view = render(<MarkdownEditor {...props} mode="compare" />);
    const update = side === "visual" ? calls.setText : calls.setMarkdown;
    update.mockClear();
    const input = view.getByTestId(side);
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "输入中" } });
    act(() => vi.advanceTimersByTime(500));
    expect(update).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "输入完成" } });
    fireEvent.compositionEnd(input);
    act(() => vi.advanceTimersByTime(200));
    expect(update).toHaveBeenLastCalledWith("输入完成");
  });

  it("places a caret from paper clicks while preserving Shift and leaving editor controls alone", () => {
    const view = render(<MarkdownEditor {...props} mode="visual" />);
    const pane = view.container.querySelector<HTMLElement>(".doc-markdown-visual")!;
    Object.defineProperty(pane, "clientWidth", { value: 600 });
    fireEvent.mouseDown(pane, { button: 0, clientX: 20, clientY: 240, shiftKey: true });
    expect(calls.placeCaret).toHaveBeenCalledWith(20, 240, true);
    calls.placeCaret.mockClear();
    fireEvent.mouseDown(view.getByTestId("visual"), { button: 0, clientX: 20 });
    fireEvent.mouseDown(pane, { button: 2, clientX: 20 });
    fireEvent.mouseDown(pane, { button: 0, clientX: 601 });
    expect(calls.placeCaret).not.toHaveBeenCalled();
  });

  it("keeps YAML front matter out of the visual editor and writes it back unchanged", () => {
    vi.useFakeTimers();
    const ref = React.createRef<MarkdownHandle>();
    const text = "---\ntitle: Notes\n---\n# Heading\n";
    const view = render(<MarkdownEditor {...props} ref={ref} defaultValue={text} mode="compare" />);
    const visual = view.getByTestId("visual") as HTMLTextAreaElement;
    expect(visual.value).toBe("# Heading\n");
    fireEvent.change(visual, { target: { value: "# Changed\n" } });
    expect(ref.current!.getText()).toBe("---\ntitle: Notes\n---\n# Changed\n");
    act(() => vi.advanceTimersByTime(200));
    expect(calls.setText).toHaveBeenLastCalledWith("---\ntitle: Notes\n---\n# Changed\n");
  });

  it("edits front matter in its own field and follows front matter edits from the source", () => {
    vi.useFakeTimers();
    const ref = React.createRef<MarkdownHandle>();
    const view = render(<MarkdownEditor {...props} ref={ref} defaultValue={"---\ntitle: A\n---\nBody\n"} mode="compare" />);
    const yaml = view.getByLabelText("Front matter") as HTMLTextAreaElement;
    expect(yaml.value).toBe("title: A");
    fireEvent.change(yaml, { target: { value: "title: B\ntags: [x]" } });
    expect(ref.current!.getText()).toBe("---\ntitle: B\ntags: [x]\n---\nBody\n");
    act(() => vi.advanceTimersByTime(200));
    expect(calls.setText).toHaveBeenLastCalledWith("---\ntitle: B\ntags: [x]\n---\nBody\n");
    fireEvent.change(view.getByTestId("source"), { target: { value: "---\ntitle: C\n---\nBody\n" } });
    act(() => vi.advanceTimersByTime(200));
    expect(yaml.value).toBe("title: C");
    expect(calls.setMarkdown).not.toHaveBeenCalled();
  });

  it("applies writing modes to both editors", () => {
    const view = render(<MarkdownEditor {...props} mode="compare" modes={{ focus: true, typewriter: false }} />);
    expect(calls.visualModes).toHaveBeenLastCalledWith({ focus: true, typewriter: false });
    expect(calls.sourceModes).toHaveBeenLastCalledWith({ focus: true, typewriter: false });
    expect(view.container.querySelector(".doc-markdown-layout")!.classList).toContain("doc-focus-mode");
    view.rerender(<MarkdownEditor {...props} mode="compare" modes={{ focus: false, typewriter: true }} />);
    expect(calls.sourceModes).toHaveBeenLastCalledWith({ focus: false, typewriter: true });
    expect(view.container.querySelector(".doc-markdown-layout")!.classList).toContain("doc-typewriter");
  });

  it("carries the reading position from the source view to the visual view", () => {
    const ref = React.createRef<MarkdownHandle>();
    const text = "# One\n\nalpha\n\n# Two\n\nbeta\n\ngamma\n";
    const view = render(<MarkdownEditor {...props} ref={ref} defaultValue={text} mode="source" />);
    // Caret on "gamma": section 1 ("# Two"), the second block after the heading.
    calls.readingPosition.mockReturnValue({ line: 8, offset: 120, caret: true });
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { callback(0); return 0; });
    ref.current!.prepareModeChange("visual");
    view.rerender(<MarkdownEditor {...props} ref={ref} defaultValue={text} mode="visual" />);
    expect(calls.revealAnchor).toHaveBeenCalledWith(expect.any(HTMLElement),
      { section: 1, ordinal: 2, fraction: 0, offset: 120, caret: true });
  });
});
