import type { Cell, Frame, Layer, ResizeAnchor, SelectionBox, Sprite } from './types';

/** Stands in for a sprite's own dimensions when it has none - see `spriteDims`. Deliberately a literal
 *  rather than an import of `storage.DEFAULT_GRID_SIZE`: this module is pure geometry with no storage
 *  dependency, and they are the same number for the same reason (a sprite with no size recorded is
 *  treated as one that was created at the default size). */
const FALLBACK_SPRITE_SIZE = 16;

/**
 * A sprite's size in cells, with a fallback for one that has none.
 *
 * The fallback is not defensive noise: sprites saved before width/height were recorded, and hand-edited
 * or imported JSON, can genuinely arrive without them, and every drawing path needs *some* number to
 * scale by rather than producing a zero-sized canvas. It was written out inline at ten call sites
 * across the two renderers, the thumbnail component and the tank engine - all agreeing on 16, which is
 * exactly the kind of agreement that survives right up until it doesn't.
 */
export function spriteDims(sprite?: Pick<Sprite, 'width' | 'height'> | null): { width: number; height: number } {
  return {
    width: sprite?.width || FALLBACK_SPRITE_SIZE,
    height: sprite?.height || FALLBACK_SPRITE_SIZE,
  };
}

/**
 * Run-length merges each row: a stretch of consecutive same-colored cells becomes one fillRect instead
 * of one per cell. Output is pixel-identical to the naive per-cell version - purely a draw-call-count
 * optimization - and it helps a lot for a mostly-uniform region (a filled background, a flood-filled
 * area). But it's a best case, not a guarantee: content with no long same-color runs (a dithered or
 * checkerboard-like pattern, which real pixel art regularly has) gets zero benefit from it and degrades
 * to exactly one fillRect call per cell - profiling a 1400×900 canvas with content like that measured
 * ~590ms for a single full-canvas repaint (worse with more layers), which is what actually made
 * painting on a large, detailed canvas stutter badly on every pointer move. RLE alone can't fix that
 * case; `region` is what does (see paintCell in usePixelEditor.ts) - bounding the scan to only the
 * (small, fixed-size) area a single brush stroke actually touches instead of the whole canvas, so cost
 * no longer scales with canvas size at all, regardless of how RLE-unfriendly the content is.
 */
export function paintFrameCells(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  width: number,
  height: number,
  cellPx: number,
  region?: SelectionBox
): void {
  const y0 = region ? Math.max(0, region.y0) : 0;
  const y1 = region ? Math.min(height - 1, region.y1) : height - 1;
  const rowX0 = region ? Math.max(0, region.x0) : 0;
  const rowX1 = region ? Math.min(width - 1, region.x1) : width - 1;
  for (let y = y0; y <= y1; y++) {
    const rowStart = y * width;
    let x = rowX0;
    while (x <= rowX1) {
      const color = frame[rowStart + x];
      if (!color) {
        x++;
        continue;
      }
      let runEnd = x + 1;
      while (runEnd <= rowX1 && frame[rowStart + runEnd] === color) runEnd++;
      ctx.fillStyle = color;
      ctx.fillRect(x * cellPx, y * cellPx, (runEnd - x) * cellPx, cellPx);
      x = runEnd;
    }
  }
}

/** Composites visible layers bottom-to-top, honoring each layer's opacity (scaled by `alphaMultiplier`,
 *  e.g. for onion skin). `region` (canvas cell coords) restricts painting to that sub-rectangle instead
 *  of the whole width×height frame - see paintFrameCells' doc comment for why that matters. */
export function paintLayers(
  ctx: CanvasRenderingContext2D,
  layers: Layer[],
  width: number,
  height: number,
  cellPx: number,
  alphaMultiplier = 1,
  region?: SelectionBox
): void {
  layers.forEach((layer) => {
    if (!layer.visible || layer.opacity <= 0) return;
    ctx.globalAlpha = layer.opacity * alphaMultiplier;
    paintFrameCells(ctx, layer.cells, width, height, cellPx, region);
  });
  ctx.globalAlpha = 1;
}

/**
 * Union bounding box (canvas cell coords) of every cell that differs between two same-size layer
 * stacks, or 'full' when they aren't safely comparable this way (different layer count, or a
 * visibility/opacity change - either can change the composited result over a layer's whole area even
 * with zero changed cells), or null when they're pixel-identical. Used by undo/redo (see
 * applyHistoryEntry in usePixelEditor.ts) to repaint only what a history step actually changed instead
 * of the whole canvas: comparing two color strings with `!==` is far cheaper than the fillRect calls a
 * repaint needs, so this scan - even though it's still O(layers x width x height) - costs a small
 * fraction of what a full paintLayers repaint of the same canvas would.
 */
export function layersDiffRegion(a: Layer[], b: Layer[], width: number, height: number): SelectionBox | 'full' | null {
  if (a.length !== b.length) return 'full';
  for (let li = 0; li < a.length; li++) {
    if (a[li].visible !== b[li].visible || a[li].opacity !== b[li].opacity) return 'full';
    if (a[li].cells.length !== b[li].cells.length) return 'full';
  }
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let li = 0; li < a.length; li++) {
    const ca = a[li].cells;
    const cb = b[li].cells;
    for (let i = 0; i < ca.length; i++) {
      if (ca[i] !== cb[i]) {
        const x = i % width;
        const y = (i - x) / width;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < x0 ? null : { x0, y0, x1, y1 };
}

export function bresenhamLine(x0: number, y0: number, x1: number, y1: number): Cell[] {
  // A NaN/Infinite input (e.g. a pointer-position calculation gone wrong upstream) would otherwise spin
  // this `while (true)` forever - `x === x1` never becomes true when either side is NaN, and Infinity
  // arithmetic never converges either - hanging the tab and eventually crashing it with an
  // out-of-memory error as `points` grows unbounded. Integer, finite inputs (the only inputs this was
  // ever designed for) are unaffected by either guard below.
  if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) {
    return [{ x: Number.isFinite(x0) ? x0 : 0, y: Number.isFinite(y0) ? y0 : 0 }];
  }
  const points: Cell[] = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  // A correct run over finite integer coordinates always finishes within manhattan-distance-many steps
  // - this cap is a pure safety net for a case that should be unreachable now, not a normal exit path.
  const maxSteps = Math.abs(x1 - x0) + Math.abs(y1 - y0) + 1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  while (true) {
    points.push({ x, y });
    if (x === x1 && y === y1) break;
    if (points.length > maxSteps) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return points;
}

export function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Whether two cell colors count as "the same" at a given tolerance - the fuzzy comparison Fill and the
 * Magic Wand both spread through. Tolerance is a percentage of the longest possible distance in RGB
 * space (black to white), so the number in the UI means the same thing regardless of which colors are
 * being compared.
 *
 * `null` (an empty cell) only ever matches another `null`, never a color, however high the tolerance:
 * "empty" is not a dark color, and letting tolerance blur the two would make a fill on a transparent
 * background swallow the artwork on it.
 */
export function colorsMatch(a: string | null, b: string | null, tolerance: number): boolean {
  if (a === b) return true;
  if (tolerance <= 0 || a === null || b === null) return false;
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const dist = Math.sqrt((ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2);
  const maxDist = Math.sqrt(255 * 255 * 3);
  return (dist / maxDist) * 100 <= tolerance;
}

export function inEllipseLocal(x: number, y: number, cx: number, cy: number, rx: number, ry: number): boolean {
  if (rx <= 0 || ry <= 0) return Math.round(x) === Math.round(cx) && Math.round(y) === Math.round(cy);
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

export function normalizeBox(a: Cell, b: Cell): SelectionBox {
  return {
    x0: Math.min(a.x, b.x),
    x1: Math.max(a.x, b.x),
    y0: Math.min(a.y, b.y),
    y1: Math.max(a.y, b.y),
  };
}

export function shiftBox(box: SelectionBox, delta: { dx: number; dy: number }): SelectionBox {
  return {
    x0: box.x0 + delta.dx,
    x1: box.x1 + delta.dx,
    y0: box.y0 + delta.dy,
    y1: box.y1 + delta.dy,
  };
}

export function flipFrameH(frame: Frame, width: number, height: number): Frame {
  const out: Frame = new Array(width * height).fill(null);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) out[y * width + (width - 1 - x)] = frame[y * width + x];
  }
  return out;
}

export function flipFrameV(frame: Frame, width: number, height: number): Frame {
  const out: Frame = new Array(width * height).fill(null);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) out[(height - 1 - y) * width + x] = frame[y * width + x];
  }
  return out;
}

/** Cyclically shifts a frame's content by half its width/height (wrapping around the edges) - lets an
 *  artist drawing a tileable 'background' sprite see the seam between repeats without leaving the
 *  editor (see PreviewPanel.tsx's tiled 3x3 preview), then nudge pixels that land on the new seam. */
export function wrapShiftFrame(frame: Frame, width: number, height: number): Frame {
  const shiftX = Math.floor(width / 2);
  const shiftY = Math.floor(height / 2);
  const out: Frame = new Array(width * height).fill(null);
  for (let y = 0; y < height; y++) {
    const ny = (y + shiftY) % height;
    for (let x = 0; x < width; x++) {
      const nx = (x + shiftX) % width;
      out[ny * width + nx] = frame[y * width + x];
    }
  }
  return out;
}

/** Standard 4x4 ordered (Bayer) dither matrix, values 0-15 - see ditherColorAt. */
const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** Picks colorA or colorB for cell (x, y) using a 4x4 ordered-dither threshold, so a 50/50 (or any
 *  other) mix of the two colors reads as a stipple pattern instead of a flat blend - used by the
 *  gradient tool's optional dither mode and the "dither brush" (see usePixelEditor.ts). `mix` is how
 *  much of colorB should show, 0 (all colorA) to 1 (all colorB). */
export function ditherColorAt(x: number, y: number, colorA: string, colorB: string, mix: number): string {
  const threshold = (BAYER_4X4[y & 3][x & 3] + 0.5) / 16;
  return mix > threshold ? colorB : colorA;
}

/** Width (as a fraction of the 0-1 gradient axis) of the dithered transition band the gradient tool
 *  stretches its `t` through via ditherGradientMix - see that function. */
const DITHER_BAND_WIDTH = 0.35;

/** Remaps a gradient's raw 0-1 position `t` so dithering (see ditherColorAt) only happens in a band
 *  centered on the midpoint, with solid colorA/colorB on either side - instead of a checker pattern
 *  fading in/out across the *entire* gradient. Values already at exactly 0.5 (e.g. the fixed-mix
 *  "dither brush" texture, not a real gradient) are unaffected, since the band is centered there. */
export function ditherGradientMix(t: number): number {
  const lo = 0.5 - DITHER_BAND_WIDTH / 2;
  return Math.min(1, Math.max(0, (t - lo) / DITHER_BAND_WIDTH));
}

export interface Hsv {
  h: number;
  s: number;
  v: number;
}

/** Hex<->HSV conversion used by ColorPicker.tsx's own HSV color wheel/slider UI. */
export function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function hexToHsv(hex: string): Hsv {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s, v };
}

/** Rotating swaps the axes: a width×height frame becomes height×width. */
export function rotateFrame(
  frame: Frame,
  width: number,
  height: number,
  clockwise: boolean
): { frame: Frame; width: number; height: number } {
  const outW = height;
  const outH = width;
  const out: Frame = new Array(outW * outH).fill(null);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const color = frame[y * width + x];
      if (!color) continue;
      const nx = clockwise ? height - 1 - y : y;
      const ny = clockwise ? x : width - 1 - x;
      out[ny * outW + nx] = color;
    }
  }
  return { frame: out, width: outW, height: outH };
}

/**
 * Frame geometry: making, stretching and cropping the flat cell array a layer is.
 *
 * Moved here from storage.ts, where it had no business being - none of it reads or writes anything,
 * it is the same per-cell arithmetic as the rest of this module.
 */
export function emptyFrame(width: number, height: number): Frame {
  return new Array(width * height).fill(null);
}

export function resampleFrame(frame: Frame, oldW: number, oldH: number, newW: number, newH: number): Frame {
  if (oldW === newW && oldH === newH) return frame.slice();
  const out = emptyFrame(newW, newH);
  for (let y = 0; y < newH; y++) {
    const srcY = Math.min(oldH - 1, Math.floor((y / newH) * oldH));
    for (let x = 0; x < newW; x++) {
      const srcX = Math.min(oldW - 1, Math.floor((x / newW) * oldW));
      out[y * newW + x] = frame[srcY * oldW + srcX];
    }
  }
  return out;
}

/** Where each 9-point ResizeAnchor sits as a 0..1 fraction across the resize delta - see padFrame. */
export const RESIZE_ANCHOR_FRAC: Record<ResizeAnchor, { x: number; y: number }> = {
  'top-left': { x: 0, y: 0 },
  'top-center': { x: 0.5, y: 0 },
  'top-right': { x: 1, y: 0 },
  'middle-left': { x: 0, y: 0.5 },
  'middle-center': { x: 0.5, y: 0.5 },
  'middle-right': { x: 1, y: 0.5 },
  'bottom-left': { x: 0, y: 1 },
  'bottom-center': { x: 0.5, y: 1 },
  'bottom-right': { x: 1, y: 1 },
};

/**
 * Crop/expand resize: places the old (oldW x oldH) frame's content at (offsetX, offsetY) inside a new
 * (newW x newH) canvas, unlike resampleFrame's stretch - pixels outside the new canvas are dropped,
 * and any newly-added area is left transparent. `offsetX`/`offsetY` are typically derived from
 * RESIZE_ANCHOR_FRAC (see usePixelEditor.ts's setGridSize) or from a content bounding box (see
 * usePixelEditor.ts's trimToContent, which crops with the exact offset needed to drop empty borders).
 */
export function padFrame(frame: Frame, oldW: number, oldH: number, newW: number, newH: number, offsetX: number, offsetY: number): Frame {
  const out = emptyFrame(newW, newH);
  for (let y = 0; y < oldH; y++) {
    const ny = y + offsetY;
    if (ny < 0 || ny >= newH) continue;
    for (let x = 0; x < oldW; x++) {
      const nx = x + offsetX;
      if (nx < 0 || nx >= newW) continue;
      out[ny * newW + nx] = frame[y * oldW + x];
    }
  }
  return out;
}

