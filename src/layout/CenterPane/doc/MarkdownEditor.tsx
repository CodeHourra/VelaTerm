import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useT } from "../../../i18n";
import { WysiwygEditor, type WritingModes, type WysiwygHandle } from "./WysiwygEditor";
import { SourceEditor, type SourceHandle } from "./SourceEditor";
import { EMPTY_STATUS, type DocSearchControl } from "./docSearch";
import { frontMatterYaml, splitFrontMatter, withFrontMatterYaml } from "./frontMatter";
import { anchorAt, blockAtLine, lineAtBlock, resolveAnchor, sourceBlocks, type ReadingAnchor } from "./readingAnchor";

export type MarkdownViewMode = "visual" | "source" | "compare";
export interface MarkdownHandle {
  getText(): string;
  insertText(text: string): void;
  search: DocSearchControl;
  scrollToHeading(index: number, line: number): void;
  /** Record the reading position before the view changes to `next`, so the new view can restore it. */
  prepareModeChange(next: MarkdownViewMode): void;
}
const EMPTY_SEARCH: DocSearchControl = {
  apply: () => EMPTY_STATUS, next: () => EMPTY_STATUS, prev: () => EMPTY_STATUS,
  replace: () => EMPTY_STATUS, replaceAll: () => EMPTY_STATUS, clear: () => {},
};
/** Coalesce companion updates; saving and changing panes always read the latest source immediately. */
const COMPANION_DELAY_MS = 150;
const NO_WRITING_MODES: WritingModes = { focus: false, typewriter: false };
export const MarkdownEditor = forwardRef<MarkdownHandle, {
  defaultValue: string;
  docPath: string;
  mode: MarkdownViewMode;
  onEdited(): void;
  onReady?(): void;
  onRequestSearch?(): void;
  onImageError(message: string): void;
  /** Focus mode and typewriter mode, applied to both views; both off when omitted. */
  modes?: WritingModes;
}>(function MarkdownEditor(props, ref) {
  const t = useT();
  const visual = useRef<WysiwygHandle>(null);
  const source = useRef<SourceHandle>(null);
  const visualPane = useRef<HTMLDivElement>(null);
  const value = useRef(props.defaultValue);
  // The visual editor edits only the body; YAML front matter is kept verbatim and edited in its own box.
  const front = useRef(splitFrontMatter(props.defaultValue).prefix);
  const [frontYaml, setFrontYaml] = useState(() => front.current ? frontMatterYaml(front.current) : null);
  const pendingAnchor = useRef<ReadingAnchor | null>(null);
  const authority = useRef<"visual" | "source">(props.mode === "source" ? "source" : "visual");
  const visualDirty = useRef(false);
  const visualReady = useRef(false);
  const appliedVisual = useRef(splitFrontMatter(props.defaultValue).body);
  const focused = useRef<"visual" | "source">(authority.current);
  const searchTarget = useRef<DocSearchControl | null>(null);
  const searchSide = useRef<"visual" | "source">(authority.current);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composing = useRef(false);
  const previousMode = useRef(props.mode);
  const focusOnReady = useRef(false);
  const [mounted, setMounted] = useState({ visual: props.mode !== "source", source: props.mode !== "visual" });
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(props);
  latest.current = props;
  const current = () => {
    if (authority.current === "visual" && visualDirty.current) {
      const text = visual.current?.getMarkdown();
      if (text != null) {
        value.current = front.current + text;
        appliedVisual.current = text;
        visualDirty.current = false;
      }
    }
    return value.current;
  };
  const cancelPending = () => {
    if (pending.current != null) clearTimeout(pending.current);
    pending.current = null;
  };
  const updateFront = (prefix: string) => {
    if (prefix === front.current) return;
    front.current = prefix;
    setFrontYaml(prefix ? frontMatterYaml(prefix) : null);
  };
  const syncVisual = () => {
    if (!visualReady.current) return;
    const { prefix, body } = splitFrontMatter(current());
    updateFront(prefix);
    if (body !== appliedVisual.current) {
      visual.current?.setMarkdown(body);
      appliedVisual.current = body;
    }
  };
  const syncSource = () => source.current?.setText(current());
  const schedule = () => {
    cancelPending();
    if (latest.current.mode !== "compare" || composing.current) return;
    pending.current = setTimeout(() => {
      pending.current = null;
      if (authority.current === "source") syncVisual();
      else syncSource();
    }, COMPANION_DELAY_MS);
  };
  const visualEdited = () => {
    authority.current = "visual";
    visualDirty.current = true;
    latest.current.onEdited();
    schedule();
  };
  const frontEdited = (yaml: string) => {
    const { prefix, body } = splitFrontMatter(current());
    front.current = withFrontMatterYaml(prefix, yaml);
    setFrontYaml(yaml);
    value.current = front.current + body;
    authority.current = "visual";
    visualDirty.current = false;
    latest.current.onEdited();
    schedule();
  };
  /** Restore a recorded reading position in the view that just became visible. */
  const applyAnchor = () => {
    const anchor = pendingAnchor.current;
    const mode = latest.current.mode;
    if (!anchor || mode === "compare" || (mode === "visual" && !visualReady.current)) return;
    pendingAnchor.current = null;
    if (mode === "visual") {
      // Wait one frame so the pane that was hidden has been laid out.
      requestAnimationFrame(() => {
        if (visualPane.current) visual.current?.revealAnchor(visualPane.current, anchor);
      });
      return;
    }
    const blocks = sourceBlocks(current());
    const { index, fraction } = resolveAnchor(blocks.map(block => block.heading), anchor);
    requestAnimationFrame(() => source.current?.revealPosition({
      line: lineAtBlock(blocks, index, fraction), offset: anchor.offset, caret: anchor.caret,
    }));
  };
  const sourceEdited = () => {
    authority.current = "source";
    visualDirty.current = false;
    value.current = source.current?.getText() ?? value.current;
    latest.current.onEdited();
    schedule();
  };
  useEffect(() => {
    cancelPending();
    setMounted(previous => ({
      visual: previous.visual || props.mode !== "source",
      source: previous.source || props.mode !== "visual",
    }));
    if (props.mode !== "source") syncVisual();
    if (props.mode !== "visual") syncSource();
    focused.current = props.mode === "source" ? "source" : "visual";
    searchTarget.current = null;
    if (previousMode.current !== props.mode) {
      previousMode.current = props.mode;
      focusOnReady.current = props.mode !== "source" && !visualReady.current;
      if (props.mode === "source") source.current?.focus();
      else if (visualReady.current) visual.current?.focus();
      applyAnchor();
    }
    // Editors persist across view changes; only companion content is reconciled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.mode]);
  useEffect(() => cancelPending, []);
  const { focus: focusMode, typewriter } = props.modes ?? NO_WRITING_MODES;
  useEffect(() => {
    visual.current?.setWritingModes({ focus: focusMode, typewriter });
    source.current?.setWritingModes({ focus: focusMode, typewriter });
  }, [focusMode, typewriter, mounted.source]);
  const target = () => focused.current === "source" ? source.current?.search ?? EMPTY_SEARCH : visual.current?.search ?? EMPTY_SEARCH;
  useImperativeHandle(ref, () => ({
    getText: current,
    insertText: text => {
      if (!visual.current) return;
      visual.current.insertText(text);
      visualEdited();
    },
    search: {
      apply: options => {
        cancelPending();
        if (focused.current === "source") syncSource(); else syncVisual();
        searchTarget.current = target();
        searchSide.current = focused.current;
        return searchTarget.current.apply(options);
      },
      next: () => (searchTarget.current ?? target()).next(),
      prev: () => (searchTarget.current ?? target()).prev(),
      replace: text => {
        const side = searchTarget.current ?? target();
        const before = searchSide.current === "source" ? source.current?.getText() : visual.current?.getMarkdown();
        const result = side.replace(text);
        const after = searchSide.current === "source" ? source.current?.getText() : visual.current?.getMarkdown();
        if (before !== after && searchSide.current === "visual") visualEdited();
        return result;
      },
      replaceAll: text => {
        const side = searchTarget.current ?? target();
        const before = searchSide.current === "source" ? source.current?.getText() : visual.current?.getMarkdown();
        const result = side.replaceAll(text);
        const after = searchSide.current === "source" ? source.current?.getText() : visual.current?.getMarkdown();
        if (before !== after && searchSide.current === "visual") visualEdited();
        return result;
      },
      clear: () => {
        source.current?.search.clear(); visual.current?.search.clear(); searchTarget.current = null;
      },
    },
    prepareModeChange: next => {
      const from = latest.current.mode;
      pendingAnchor.current = null;
      if (from === next || from === "compare" || next === "compare") return;
      if (from === "visual") {
        pendingAnchor.current = visualPane.current && visual.current?.readingAnchor(visualPane.current) || null;
        return;
      }
      const position = source.current?.readingPosition();
      if (!position) return;
      const blocks = sourceBlocks(current());
      const { index, fraction } = blockAtLine(blocks, position.line);
      pendingAnchor.current = anchorAt(blocks.map(block => block.heading), index, fraction, position.offset, position.caret);
    },
    scrollToHeading: (index, line) => {
      if (props.mode !== "source") visual.current?.scrollToHeading(index);
      if (props.mode !== "visual") source.current?.scrollToLine(line);
    },
  }));
  const layoutClass = ["doc-markdown-layout", props.mode === "compare" && "doc-markdown-layout--compare",
    focusMode && "doc-focus-mode", typewriter && "doc-typewriter"].filter(Boolean).join(" ");
  return <div className={layoutClass}
    onCompositionStartCapture={() => { composing.current = true; cancelPending(); }}
    onCompositionEndCapture={() => { composing.current = false; schedule(); }}>
    {(mounted.visual || props.mode !== "source") && <div ref={visualPane} className="doc-markdown-pane doc-markdown-visual" hidden={props.mode === "source"}
      onMouseDown={event => {
        // Only the paper gutter uses coordinate placement; native text selection and widgets keep their behavior.
        if (event.button !== 0 || composing.current) return;
        const target = event.target as HTMLElement;
        if (target !== event.currentTarget && !target.matches(".docview-wysiwyg, .milkdown")) return;
        // A scrollbar press must remain a scrollbar press.
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX >= rect.left + event.currentTarget.clientLeft + event.currentTarget.clientWidth) return;
        event.preventDefault();
        cancelPending();
        syncVisual();
        visual.current?.placeCaret(event.clientX, event.clientY, event.shiftKey);
      }}
      onFocusCapture={() => { cancelPending(); syncVisual(); focused.current = "visual"; }}>
      {frontYaml != null && <div className="doc-frontmatter">
        <textarea aria-label={t("doc.frontMatter")} spellCheck={false} value={frontYaml}
          rows={Math.max(1, frontYaml.split("\n").length)}
          onFocus={() => { cancelPending(); focused.current = "visual"; }}
          onChange={event => frontEdited(event.target.value)} />
      </div>}
      <WysiwygEditor key={attempt} ref={visual} defaultValue={splitFrontMatter(value.current).body} docPath={props.docPath}
        onEdited={visualEdited} onReady={() => {
          // Initialization can finish after the source side has already changed.
          visualReady.current = true;
          syncVisual();
          visual.current?.setWritingModes(latest.current.modes ?? NO_WRITING_MODES);
          applyAnchor();
          if (focusOnReady.current && latest.current.mode !== "source") {
            focusOnReady.current = false;
            visual.current?.focus();
          }
          setError(false);
          latest.current.onReady?.();
        }} onError={() => { visualReady.current = false; setError(true); }} />
      {error && <div className="doc-markdown-error" role="alert">
        <span>{t("doc.editorLoadFailed")}</span>
        <button className="vlx-btn" onClick={() => { visualReady.current = false; setError(false); setAttempt(n => n + 1); }}>{t("common.retry")}</button>
      </div>}
    </div>}
    {(mounted.source || props.mode !== "visual") && <div className="doc-markdown-pane doc-markdown-code" hidden={props.mode === "visual"}
      onFocusCapture={() => { cancelPending(); syncSource(); focused.current = "source"; }}>
      <SourceEditor ref={source} defaultValue={current()} path={props.docPath} kind="markdown"
        onEdited={sourceEdited} onRequestSearch={props.onRequestSearch}
        onImagePasteError={(_, message) => props.onImageError(message)}
        onImageClipboardUnavailable={() => props.onImageError(t("term.imgClipboardUnavailable"))} />
    </div>}
  </div>;
});
