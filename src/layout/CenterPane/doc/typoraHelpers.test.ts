import { describe, expect, it } from "vitest";
import { frontMatterLines, frontMatterYaml, splitFrontMatter, withFrontMatterYaml } from "./frontMatter";
import { countDocument } from "./docStats";
import { anchorAt, blockAtLine, lineAtBlock, resolveAnchor, sourceBlocks } from "./readingAnchor";
import { headingSlug, resolveDocLink } from "./docLinks";
import { parseOutline } from "./DocOutline";

describe("front matter", () => {
  it("splits only a leading fenced block and keeps its bytes", () => {
    expect(splitFrontMatter("---\r\ntitle: A\r\n---\r\nBody")).toEqual({ prefix: "---\r\ntitle: A\r\n---\r\n", body: "Body" });
    expect(splitFrontMatter("---\n---\nBody").prefix).toBe("---\n---\n");
    expect(splitFrontMatter("---\ntitle: A\n---").body).toBe("");
    expect(splitFrontMatter("Intro\n---\ntitle: A\n---\n").prefix).toBe("");
    expect(splitFrontMatter("---\nunterminated\n").prefix).toBe("");
  });

  it("edits the YAML between the fences without changing line endings", () => {
    const prefix = "---\r\ntitle: A\r\n---\r\n";
    expect(frontMatterYaml(prefix)).toBe("title: A");
    expect(withFrontMatterYaml(prefix, "title: B\ntags: [x]")).toBe("---\r\ntitle: B\r\ntags: [x]\r\n---\r\n");
    expect(withFrontMatterYaml("---\na: 1\n---", "")).toBe("---\n---");
    expect(frontMatterLines(prefix)).toBe(3);
    expect(frontMatterLines("---\na: 1\n---")).toBe(3);
  });

  it("keeps YAML comments out of the outline", () => {
    const outline = parseOutline("---\n# comment: yes\n---\n# Title\n");
    expect(outline).toEqual([{ level: 1, text: "Title", line: 3 }]);
  });
});

describe("document statistics", () => {
  it("counts CJK characters and Latin words from the readable text", () => {
    const stats = countDocument("---\ntitle: ignored words here\n---\n# Hello world\n\n你好，世界 and **bold** [link](https://example.com/a-b)\n");
    // hello, world, 你, 好, 世, 界, and, bold, link
    expect(stats.words).toBe(9);
    expect(stats.lines).toBe(6);
    expect(stats.minutes).toBe(1);
  });

  it("reports an empty document as zero", () => {
    expect(countDocument("")).toEqual({ words: 0, characters: 0, lines: 0, minutes: 0 });
  });
});

describe("reading position mapping", () => {
  const text = [
    "---", "title: A", "---",
    "Intro",
    "",
    "# One",
    "para one",
    "continues",
    "- item",
    "",
    "- loose item",
    "",
    "```js",
    "",
    "# not a heading",
    "```",
    "Setext",
    "======",
    "> quote",
    "---",
  ].join("\n");

  it("splits source into the blocks ProseMirror creates", () => {
    expect(sourceBlocks(text)).toEqual([
      { start: 3, end: 3, heading: false },
      { start: 5, end: 5, heading: true },
      { start: 6, end: 7, heading: false },
      { start: 8, end: 10, heading: false },
      { start: 12, end: 15, heading: false },
      { start: 16, end: 17, heading: true },
      { start: 18, end: 18, heading: false },
      { start: 19, end: 19, heading: false },
    ]);
  });

  it("round-trips an anchor through heading sections", () => {
    const blocks = sourceBlocks(text);
    const headings = blocks.map(block => block.heading);
    const { index, fraction } = blockAtLine(blocks, 7);
    const anchor = anchorAt(headings, index, fraction, 40, true);
    expect(anchor).toEqual({ section: 0, ordinal: 1, fraction: 0.5, offset: 40, caret: true });
    const resolved = resolveAnchor(headings, anchor);
    expect(lineAtBlock(blocks, resolved.index, resolved.fraction)).toBe(7);
  });

  it("clamps inside a shorter section instead of spilling into the next one", () => {
    const target = [false, true, false, true, false];
    expect(resolveAnchor(target, { section: 0, ordinal: 5, fraction: 0.2, offset: 0, caret: false })).toEqual({ index: 2, fraction: 1 });
    expect(resolveAnchor([true, false], { section: -1, ordinal: 0, fraction: 0.5, offset: 0, caret: false })).toEqual({ index: 0, fraction: 0 });
    expect(resolveAnchor(target, { section: 4, ordinal: 0, fraction: 0, offset: 0, caret: false })).toEqual({ index: 4, fraction: 1 });
  });
});

describe("link targets", () => {
  it("classifies anchors, external URLs, and relative files", () => {
    expect(resolveDocLink("#Getting%20Started", "/d/a.md")).toEqual({ kind: "anchor", id: "Getting Started" });
    expect(resolveDocLink("https://example.com", "/d/a.md")).toEqual({ kind: "external", url: "https://example.com" });
    expect(resolveDocLink("www.example.com", "/d/a.md")).toEqual({ kind: "external", url: "https://www.example.com" });
    expect(resolveDocLink("../notes/b%20c.md#part", "/d/docs/a.md")).toEqual({ kind: "file", path: "/d/notes/b c.md", anchor: "part" });
    expect(resolveDocLink("img/x.png?raw=1", "C:\\docs\\a.md")).toEqual({ kind: "file", path: "C:\\docs\\img\\x.png", anchor: "" });
    expect(resolveDocLink("file:///C:/docs/b.md", "/d/a.md")).toEqual({ kind: "file", path: "C:/docs/b.md", anchor: "" });
  });

  it("refuses scripts and relative links in unsaved drafts", () => {
    expect(resolveDocLink("javascript:alert(1)", "/d/a.md")).toBeNull();
    expect(resolveDocLink("b.md", "")).toBeNull();
    expect(resolveDocLink("#", "/d/a.md")).toBeNull();
  });

  it("builds GitHub-style heading slugs", () => {
    expect(headingSlug("Getting Started: Step 1!")).toBe("getting-started-step-1");
    expect(headingSlug("安装与配置")).toBe("安装与配置");
  });
});
