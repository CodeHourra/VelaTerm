import { describe, expect, it } from "vitest";
import { arrowGeometry, clampMove, hitHandle, isMeaningful, resizeBox, toolbarPosition } from "./scene";

const screen = { w: 1000, h: 800 };

describe("selection geometry", () => {
  const box = { x: 100, y: 100, w: 200, h: 100 };

  it("hits corners before edges and edges along their whole length", () => {
    expect(hitHandle(box, { x: 102, y: 99 })).toBe("nw");
    expect(hitHandle(box, { x: 160, y: 200 })).toBe("s");
    expect(hitHandle(box, { x: 301, y: 130 })).toBe("e");
    expect(hitHandle(box, { x: 200, y: 150 })).toBeNull();
  });

  it("flips instead of collapsing when a handle crosses the opposite edge", () => {
    expect(resizeBox(box, "e", { x: 50, y: 0 }, screen)).toEqual({ x: 50, y: 100, w: 50, h: 100 });
  });

  it("keeps moved and resized boxes on screen", () => {
    expect(clampMove({ x: 900, y: -20, w: 200, h: 100 }, screen)).toEqual({ x: 800, y: 0, w: 200, h: 100 });
    expect(resizeBox(box, "se", { x: 5000, y: 5000 }, screen)).toEqual({ x: 100, y: 100, w: 900, h: 700 });
  });
});

describe("toolbarPosition", () => {
  const size = { w: 300, h: 40 };

  it("prefers below, then above, then inside", () => {
    expect(toolbarPosition({ x: 100, y: 100, w: 400, h: 200 }, size, screen)).toEqual({ x: 200, y: 308 });
    expect(toolbarPosition({ x: 100, y: 500, w: 400, h: 280 }, size, screen).y).toBe(452);
    expect(toolbarPosition({ x: 0, y: 0, w: 1000, h: 800 }, size, screen).y).toBe(752);
  });

  it("stays within the screen horizontally", () => {
    expect(toolbarPosition({ x: 0, y: 100, w: 50, h: 50 }, size, screen).x).toBe(4);
  });
});

describe("shapes", () => {
  it("drops clicks that drew nothing", () => {
    const a = { x: 10, y: 10 };
    expect(isMeaningful({ kind: "rect", a, b: { x: 11, y: 11 }, color: "#f00", width: 2 })).toBe(false);
    expect(isMeaningful({ kind: "arrow", a, b: { x: 40, y: 10 }, color: "#f00", width: 2 })).toBe(true);
    expect(isMeaningful({ kind: "text", at: a, text: "  \n", color: "#f00", size: 14 })).toBe(false);
  });

  it("puts the arrow tip at the end point", () => {
    const g = arrowGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, 4)!;
    expect(g.head[0]).toEqual({ x: 100, y: 0 });
    expect(g.shaftEnd.x).toBeLessThan(100);
    expect(arrowGeometry({ x: 5, y: 5 }, { x: 5, y: 5 }, 4)).toBeNull();
  });
});
