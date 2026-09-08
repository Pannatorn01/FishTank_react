import { hexToRgb } from '../../pixelMath';
import type { Cell } from '../../types';
import { mirrorPoints, withSelectionClip, type CellWriter } from '../paintPipeline';
import { DirtyRectTracker } from '../dirtyRect';
import type { Gesture, GestureResult, PaintOp, Tool, ToolContext, ToolPointerEvent, ToolPreview } from '../types';

/** Ports `colorsMatch` (usePixelEditor.ts:3574-3582; also duplicated in magicWandTool.ts - a third
 *  copy, same established precedent as elsewhere in this directory). */
function colorsMatch(a: string | null, b: string | null, tolerance: number): boolean {
  if (a === b) return true;
  if (tolerance <= 0 || a === null || b === null) return false;
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const dist = Math.sqrt((ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2);
  const maxDist = Math.sqrt(255 * 255 * 3);
  return (dist / maxDist) * 100 <= tolerance;
}

/** Ports `isInsideSelection`/`paintAllowed` (usePixelEditor.ts:1876-1891). */
function inSelection(x: number, y: number, ctx: ToolContext): boolean {
  if (!ctx.selection) return true;
  const s = ctx.selection;
  if (x < s.x0 || x > s.x1 || y < s.y0 || y > s.y1) return false;
  if (ctx.selectionMask) return ctx.selectionMask.has(`${x},${y}`);
  return true;
}

/**
 * Contiguous flood fill from (x, y) - ports `floodFill` (usePixelEditor.ts:3593-3641). The selection
 * acts as a traversal *barrier* here, not just an output filter: the `inSelection` check runs inside
 * the loop's continuation test, exactly like the color-match check, so two disjoint regions inside a
 * selection that are only connected via a path *outside* it do not both fill from clicking one of
 * them - matching the original's own `paintAllowed` check placement precisely.
 */
function floodFillOps(ctx: ToolContext, x: number, y: number, target: string | null, fillColor: string | null, tolerance: number): PaintOp[] {
  if (colorsMatch(target, fillColor, tolerance)) return [];
  const ops: PaintOp[] = [];
  const visited = new Set<string>();
  const stack: Cell[] = [{ x, y }];
  visited.add(`${x},${y}`);
  while (stack.length) {
    const p = stack.pop()!;
    if (!colorsMatch(ctx.getCell(p.x, p.y), target, tolerance)) continue;
    if (!inSelection(p.x, p.y, ctx)) continue;
    ops.push({ x: p.x, y: p.y, color: fillColor });
    const tryPush = (nx: number, ny: number) => {
      if (nx < 0 || ny < 0 || nx >= ctx.width || ny >= ctx.height) return;
      const key = `${nx},${ny}`;
      if (visited.has(key)) return;
      visited.add(key);
      stack.push({ x: nx, y: ny });
    };
    tryPush(p.x + 1, p.y);
    tryPush(p.x - 1, p.y);
    tryPush(p.x, p.y + 1);
    tryPush(p.x, p.y - 1);
  }
  return ops;
}

/** Shift+click: every pixel in the layer matching `target`, not just the contiguous region - ports
 *  `globalReplace` (usePixelEditor.ts:3645-3657). A flat, non-traversal pass, so a plain
 *  `withSelectionClip` output filter is correct here (no leak-through/reconnect risk the way a
 *  connectivity operation would have). Ignores symmetry entirely, matching the original - a global
 *  replace already reaches everywhere a mirror could, so mirroring would be redundant. */
function globalReplaceOps(ctx: ToolContext, target: string | null, fillColor: string | null, tolerance: number): PaintOp[] {
  const ops: PaintOp[] = [];
  const sink: CellWriter = (op) => ops.push(op);
  const write = withSelectionClip(ctx.selection, ctx.selectionMask, sink);
  for (let y = 0; y < ctx.height; y++) {
    for (let x = 0; x < ctx.width; x++) {
      if (colorsMatch(ctx.getCell(x, y), target, tolerance)) write({ x, y, color: fillColor });
    }
  }
  return ops;
}

class FillGesture implements Gesture {
  readonly kind = 'fill';
  private result: GestureResult;
  constructor(result: GestureResult) {
    this.result = result;
  }
  onPointerMove(): ToolPreview | null {
    return null;
  }
  onPointerUp(): GestureResult {
    return this.result;
  }
  onCancel(): GestureResult {
    return { ops: [], dirtyRects: [], changed: false, cancelled: true };
  }
}

export function createFillTool(): Tool {
  return {
    name: 'fill',
    beginGesture(e: ToolPointerEvent, ctx: ToolContext) {
      const fillColor = e.button === 2 ? null : ctx.color;
      let ops: PaintOp[];
      if (e.shiftKey) {
        const target = ctx.getCell(e.cell.x, e.cell.y);
        ops = globalReplaceOps(ctx, target, fillColor, ctx.fillTolerance);
      } else {
        // A plain click floods once PER MIRRORED START POINT, each sampling its own target color and
        // flooding independently - not the shared withSymmetry pipeline (mirror one final color across
        // copies). Matches the original's own `mirrorCells(...).forEach(m => floodFill(...))`
        // (usePixelEditor.ts:2749-2751) exactly - N independent floods, not one mirrored result.
        ops = [];
        const seen = new Set<string>();
        mirrorPoints(ctx.symmetry, ctx.symmetryAxisX, ctx.symmetryAxisY, e.cell.x, e.cell.y).forEach((m) => {
          const target = ctx.getCell(m.x, m.y);
          floodFillOps(ctx, m.x, m.y, target, fillColor, ctx.fillTolerance).forEach((op) => {
            const key = `${op.x},${op.y}`;
            if (!seen.has(key)) {
              seen.add(key);
              ops.push(op);
            }
          });
        });
      }
      const changed = ops.some((op) => ctx.getCell(op.x, op.y) !== op.color);
      const dirty = new DirtyRectTracker();
      dirty.addCells(ops);
      return new FillGesture({ ops, dirtyRects: dirty.toRects(ctx.width, ctx.height), changed });
    },
  };
}
