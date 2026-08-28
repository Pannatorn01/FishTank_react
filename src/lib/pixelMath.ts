import type { Cell, Frame, SelectionBox } from './types';

export function paintFrameCells(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  size: number,
  cellPx: number
): void {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const color = frame[y * size + x];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x * cellPx, y * cellPx, cellPx, cellPx);
    }
  }
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

export function flipFrameH(frame: Frame, size: number): Frame {
  const out: Frame = new Array(size * size).fill(null);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) out[y * size + (size - 1 - x)] = frame[y * size + x];
  }
  return out;
}

export function flipFrameV(frame: Frame, size: number): Frame {
  const out: Frame = new Array(size * size).fill(null);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) out[(size - 1 - y) * size + x] = frame[y * size + x];
  }
  return out;
}

export function rotateFrame(frame: Frame, size: number, clockwise: boolean): Frame {
  const out: Frame = new Array(size * size).fill(null);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const color = frame[y * size + x];
      if (!color) continue;
      const nx = clockwise ? size - 1 - y : y;
      const ny = clockwise ? x : size - 1 - x;
      out[ny * size + nx] = color;
    }
  }
  return out;
}
