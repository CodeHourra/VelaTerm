//! Screenshot annotation model and canvas rendering, shared by the on-screen preview and the export.
//!
//! All coordinates are CSS pixels of the overlay window, which covers exactly one monitor. The same
//! drawing code renders the preview (canvas transform = devicePixelRatio) and the exported PNG
//! (transform = captured pixels per CSS pixel, translated to the selection's origin).

export type Tool = "rect" | "ellipse" | "arrow" | "pen" | "mosaic" | "text";

export interface Pt {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Shape =
  | { kind: "rect" | "ellipse" | "arrow"; a: Pt; b: Pt; color: string; width: number }
  | { kind: "pen"; points: Pt[]; color: string; width: number }
  | { kind: "mosaic"; points: Pt[]; width: number }
  | { kind: "text"; at: Pt; text: string; color: string; size: number };

/** Selection resize handles: corners and edge midpoints. */
export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** Palette offered by the toolbar; red first because it is the usual annotation color. */
export const COLORS = ["#f5222d", "#faad14", "#52c41a", "#1677ff", "#ffffff", "#1f1f1f"];

/** Small / medium / large, per tool family. */
export const STROKE_WIDTHS = [2, 4, 7];
export const TEXT_SIZES = [14, 20, 28];
export const MOSAIC_WIDTHS = [12, 22, 36];

/** Mosaic block edge in CSS pixels. */
export const MOSAIC_BLOCK = 9;

export const TEXT_LINE_HEIGHT = 1.3;

export function textFont(size: number): string {
  return `500 ${size}px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif`;
}

/** Positive-size box spanning two points. */
export function boxFrom(a: Pt, b: Pt): Box {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

/** Keep a box inside `bounds` without changing its size where possible (used when moving). */
export function clampMove(box: Box, bounds: { w: number; h: number }): Box {
  const w = Math.min(box.w, bounds.w);
  const h = Math.min(box.h, bounds.h);
  return {
    x: Math.min(Math.max(0, box.x), bounds.w - w),
    y: Math.min(Math.max(0, box.y), bounds.h - h),
    w,
    h,
  };
}

export function contains(box: Box, p: Pt): boolean {
  return p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h;
}

/** Center of each handle. */
export function handlePoint(box: Box, h: Handle): Pt {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const r = box.x + box.w;
  const b = box.y + box.h;
  switch (h) {
    case "nw": return { x: box.x, y: box.y };
    case "n": return { x: cx, y: box.y };
    case "ne": return { x: r, y: box.y };
    case "e": return { x: r, y: cy };
    case "se": return { x: r, y: b };
    case "s": return { x: cx, y: b };
    case "sw": return { x: box.x, y: b };
    case "w": return { x: box.x, y: cy };
  }
}

/** Handle under the pointer: a corner, or anywhere along an edge. Corners win where they overlap. */
export function hitHandle(box: Box, p: Pt, radius = 6): Handle | null {
  const near = (h: Handle) => {
    const c = handlePoint(box, h);
    return Math.abs(c.x - p.x) <= radius && Math.abs(c.y - p.y) <= radius;
  };
  const corner = (["nw", "ne", "se", "sw"] as Handle[]).find(near);
  if (corner) return corner;
  const withinX = p.x >= box.x && p.x <= box.x + box.w;
  const withinY = p.y >= box.y && p.y <= box.y + box.h;
  if (withinX && Math.abs(p.y - box.y) <= radius) return "n";
  if (withinX && Math.abs(p.y - (box.y + box.h)) <= radius) return "s";
  if (withinY && Math.abs(p.x - box.x) <= radius) return "w";
  if (withinY && Math.abs(p.x - (box.x + box.w)) <= radius) return "e";
  return null;
}

/**
 * Resize `box` by dragging `handle` to `p`. Dragging past the opposite edge flips the box rather than
 * collapsing it, and the result stays inside `bounds`.
 */
export function resizeBox(box: Box, handle: Handle, p: Pt, bounds: { w: number; h: number }): Box {
  const x = Math.min(Math.max(0, p.x), bounds.w);
  const y = Math.min(Math.max(0, p.y), bounds.h);
  let left = box.x;
  let top = box.y;
  let right = box.x + box.w;
  let bottom = box.y + box.h;
  if (handle.includes("w")) left = x;
  if (handle.includes("e")) right = x;
  if (handle.includes("n")) top = y;
  if (handle.includes("s")) bottom = y;
  return boxFrom({ x: left, y: top }, { x: right, y: bottom });
}

/** CSS cursor for a handle. */
export function handleCursor(h: Handle): string {
  return h === "n" || h === "s"
    ? "ns-resize"
    : h === "e" || h === "w"
      ? "ew-resize"
      : h === "nw" || h === "se"
        ? "nwse-resize"
        : "nesw-resize";
}

/**
 * Where to place a toolbar of `size` for `sel`: right-aligned below the selection, above it when
 * there is no room below, and inside its bottom edge when neither fits.
 */
export function toolbarPosition(
  sel: Box,
  size: { w: number; h: number },
  screen: { w: number; h: number },
  gap = 8,
): Pt {
  const x = Math.min(Math.max(4, sel.x + sel.w - size.w), screen.w - size.w - 4);
  const below = sel.y + sel.h + gap;
  if (below + size.h <= screen.h - 4) return { x, y: below };
  const above = sel.y - gap - size.h;
  if (above >= 4) return { x, y: above };
  return { x, y: Math.max(4, sel.y + sel.h - size.h - gap) };
}

/** Whether a finished draft is worth keeping (a click without movement draws nothing). */
export function isMeaningful(s: Shape): boolean {
  switch (s.kind) {
    case "rect":
    case "ellipse":
    case "arrow":
      return Math.abs(s.b.x - s.a.x) >= 3 || Math.abs(s.b.y - s.a.y) >= 3;
    case "pen":
    case "mosaic":
      return s.points.length > 0;
    case "text":
      return s.text.trim().length > 0;
  }
}

/** Arrow outline: shaft end (where the head starts) and the head triangle. */
export function arrowGeometry(a: Pt, b: Pt, width: number): { shaftEnd: Pt; head: [Pt, Pt, Pt] } | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return null;
  const ux = dx / len;
  const uy = dy / len;
  const headLen = Math.min(len, 10 + width * 3);
  const half = headLen * 0.5;
  const base = { x: b.x - ux * headLen, y: b.y - uy * headLen };
  return {
    shaftEnd: { x: b.x - ux * headLen * 0.6, y: b.y - uy * headLen * 0.6 },
    head: [
      { x: b.x, y: b.y },
      { x: base.x - uy * half, y: base.y + ux * half },
      { x: base.x + uy * half, y: base.y - ux * half },
    ],
  };
}

/** Pixelated copy of the frame, drawn over mosaic strokes. */
export interface MosaicSource {
  canvas: HTMLCanvasElement;
  /** Size of the frame in CSS pixels, i.e. the overlay size. */
  cssWidth: number;
  cssHeight: number;
}

/** Build the pixelated frame once per screenshot. `scale` is captured pixels per CSS pixel. */
export function makeMosaicSource(img: HTMLImageElement, cssWidth: number, cssHeight: number): MosaicSource {
  const scale = img.naturalWidth / cssWidth;
  const block = Math.max(1, Math.round(MOSAIC_BLOCK * scale));
  const cols = Math.ceil(img.naturalWidth / block);
  const rows = Math.ceil(img.naturalHeight / block);
  const small = document.createElement("canvas");
  small.width = cols;
  small.height = rows;
  const sctx = small.getContext("2d")!;
  sctx.imageSmoothingQuality = "high";
  sctx.drawImage(img, 0, 0, cols * block, rows * block, 0, 0, cols, rows);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, cols * block, rows * block);
  return { canvas, cssWidth, cssHeight };
}

function strokePolyline(ctx: CanvasRenderingContext2D, points: Pt[], width: number, color: string) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, width / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  // Quadratic curves through segment midpoints smooth the jitter of raw pointer samples.
  for (let i = 1; i < points.length - 1; i++) {
    const mx = (points[i].x + points[i + 1].x) / 2;
    const my = (points[i].y + points[i + 1].y) / 2;
    ctx.quadraticCurveTo(points[i].x, points[i].y, mx, my);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

let scratch: HTMLCanvasElement | null = null;

/** Mosaic stroke: mask the stroke on a scratch canvas, fill it with the pixelated frame, composite. */
function drawMosaic(ctx: CanvasRenderingContext2D, s: Extract<Shape, { kind: "mosaic" }>, src: MosaicSource) {
  const target = ctx.canvas;
  scratch ??= document.createElement("canvas");
  if (scratch.width !== target.width || scratch.height !== target.height) {
    scratch.width = target.width;
    scratch.height = target.height;
  }
  const t = scratch.getContext("2d")!;
  t.setTransform(1, 0, 0, 1, 0, 0);
  t.globalCompositeOperation = "source-over";
  t.clearRect(0, 0, scratch.width, scratch.height);
  t.setTransform(ctx.getTransform());
  strokePolyline(t, s.points, s.width, "#000");
  t.globalCompositeOperation = "source-in";
  t.imageSmoothingEnabled = false;
  t.drawImage(src.canvas, 0, 0, src.cssWidth, src.cssHeight);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(scratch, 0, 0);
  ctx.restore();
}

export function drawShape(ctx: CanvasRenderingContext2D, s: Shape, mosaic: MosaicSource | null) {
  ctx.save();
  switch (s.kind) {
    case "rect": {
      const b = boxFrom(s.a, s.b);
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.lineJoin = "miter";
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      break;
    }
    case "ellipse": {
      const b = boxFrom(s.a, s.b);
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.beginPath();
      ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case "arrow": {
      const g = arrowGeometry(s.a, s.b, s.width);
      if (!g) break;
      ctx.strokeStyle = s.color;
      ctx.fillStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(s.a.x, s.a.y);
      ctx.lineTo(g.shaftEnd.x, g.shaftEnd.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(g.head[0].x, g.head[0].y);
      ctx.lineTo(g.head[1].x, g.head[1].y);
      ctx.lineTo(g.head[2].x, g.head[2].y);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "pen":
      strokePolyline(ctx, s.points, s.width, s.color);
      break;
    case "mosaic":
      if (mosaic) drawMosaic(ctx, s, mosaic);
      break;
    case "text": {
      ctx.fillStyle = s.color;
      ctx.font = textFont(s.size);
      ctx.textBaseline = "top";
      const lineHeight = s.size * TEXT_LINE_HEIGHT;
      // Center each glyph run in its line box, matching the textarea used while typing.
      const inset = (lineHeight - s.size) / 2;
      s.text.split("\n").forEach((line, i) => ctx.fillText(line, s.at.x, s.at.y + inset + i * lineHeight));
      break;
    }
  }
  ctx.restore();
}

/** Draw every shape clipped to the selection. The caller sets the CSS-to-canvas transform. */
export function drawShapes(ctx: CanvasRenderingContext2D, shapes: Shape[], clip: Box, mosaic: MosaicSource | null) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(clip.x, clip.y, clip.w, clip.h);
  ctx.clip();
  for (const s of shapes) drawShape(ctx, s, mosaic);
  ctx.restore();
}

/** Render the selection with its annotations at the captured resolution and encode it as PNG. */
export async function exportPng(
  img: HTMLImageElement,
  sel: Box,
  shapes: Shape[],
  mosaic: MosaicSource | null,
  cssWidth: number,
): Promise<Uint8Array> {
  const k = img.naturalWidth / cssWidth;
  const sx = Math.round(sel.x * k);
  const sy = Math.round(sel.y * k);
  const w = Math.max(1, Math.round(sel.w * k));
  const h = Math.max(1, Math.round(sel.h * k));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, sx, sy, w, h, 0, 0, w, h);
  ctx.setTransform(k, 0, 0, k, -sx, -sy);
  drawShapes(ctx, shapes, sel, mosaic);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Failed to encode the screenshot.");
  return new Uint8Array(await blob.arrayBuffer());
}
