import type { Cell, SymmetryMode } from '../types';
import { mirrorPoints } from './paintPipeline';
import type { ToolContext } from './types';

/** Square of side `brushSize` centered as closely as possible on (x, y) - the set of cells one brush
 *  stamp covers. An even brush size can't be centered exactly, so it leans up and left (the extra row
 *  and column go on the high side), which is what makes a 2px brush feel anchored to the cell under
 *  the cursor rather than diagonally offset from it. */
export function brushCellsAt(x: number, y: number, brushSize: number): Cell[] {
  if (brushSize <= 1) return [{ x, y }];
  const off = Math.floor((brushSize - 1) / 2);
  const cells: Cell[] = [];
  for (let dy = 0; dy < brushSize; dy++) {
    for (let dx = 0; dx < brushSize; dx++) cells.push({ x: x - off + dx, y: y - off + dy });
  }
  return cells;
}

/** Thickens a 1px path to `brushSize` by stamping `brushCellsAt` at every point along it and deduping
 *  the overlap - how Line and Curve turn a bresenham/bezier point list into a stroke with width. */
export function thickenPath(points: Cell[], brushSize: number): Cell[] {
  if (brushSize <= 1) return points;
  const seen = new Set<string>();
  const cells: Cell[] = [];
  points.forEach((p) => {
    brushCellsAt(p.x, p.y, brushSize).forEach((c) => {
      const key = `${c.x},${c.y}`;
      if (!seen.has(key)) {
        seen.add(key);
        cells.push(c);
      }
    });
  });
  return cells;
}

/** Mirror-expands a whole cell list at once, deduped. This is the shape/curve counterpart to the
 *  per-point mirroring `withSymmetry` does inside the paint pipeline: a shape mirrors its finished
 *  preview once up front (so the overlay the artist sees is already the mirrored result), and the
 *  commit then writes that already-mirrored list through a selection-clip without mirroring again. */
export function mirrorExpand(cells: Cell[], symmetry: SymmetryMode, axisX: number, axisY: number): Cell[] {
  if (symmetry === 'none') return cells;
  const seen = new Set<string>();
  const out: Cell[] = [];
  cells.forEach((c) => {
    mirrorPoints(symmetry, axisX, axisY, c.x, c.y).forEach((m) => {
      const key = `${m.x},${m.y}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(m);
      }
    });
  });
  return out;
}

/** Whether a cell is on the canvas at all - the guard the selection tools use to reject a gesture that
 *  starts outside it. */
export function inBounds(cell: Cell, ctx: ToolContext): boolean {
  return cell.x >= 0 && cell.y >= 0 && cell.x < ctx.width && cell.y < ctx.height;
}
