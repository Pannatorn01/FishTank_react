import type { Cell, Frame, Layer, SelectionBox } from './types';

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
  const points: Cell[] = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  while (true) {
    points.push({ x, y });
    if (x === x1 && y === y1) break;
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
