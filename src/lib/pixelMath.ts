import type { Cell, Frame, Layer, SelectionBox } from './types';

export function paintFrameCells(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  width: number,
  height: number,
  cellPx: number
): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const color = frame[y * width + x];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x * cellPx, y * cellPx, cellPx, cellPx);
    }
  }
}

/** Composites visible layers bottom-to-top, honoring each layer's opacity (scaled by `alphaMultiplier`, e.g. for onion skin). */
export function paintLayers(
  ctx: CanvasRenderingContext2D,
  layers: Layer[],
  width: number,
  height: number,
  cellPx: number,
  alphaMultiplier = 1
): void {
  layers.forEach((layer) => {
    if (!layer.visible || layer.opacity <= 0) return;
    ctx.globalAlpha = layer.opacity * alphaMultiplier;
    paintFrameCells(ctx, layer.cells, width, height, cellPx);
  });
  ctx.globalAlpha = 1;
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
