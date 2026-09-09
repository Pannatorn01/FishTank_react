import { colorsMatch } from '../../pixelMath';
import type { Cell, SelectionMode } from '../../types';
import { settleSelection } from '../selectionMask';
import type { Gesture, GestureResult, Tool, ToolContext, ToolPointerEvent, ToolPreview } from '../types';

/** Contiguous flood-select - ports `floodSelectMask` (usePixelEditor.ts:3666-3688), reading the frame
 *  through `ToolContext.getCell` (point reads) instead of a plain array. */
function floodSelectMask(ctx: ToolContext, x: number, y: number, target: string | null, tolerance: number): Set<string> {
  const mask = new Set<string>();
  const visited = new Set<string>();
  const stack: Cell[] = [{ x, y }];
  visited.add(`${x},${y}`);
  while (stack.length) {
    const p = stack.pop()!;
    if (!colorsMatch(ctx.getCell(p.x, p.y), target, tolerance)) continue;
    mask.add(`${p.x},${p.y}`);
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
  return mask;
}

/** Every matching pixel in the layer, contiguous or not - ports `globalSelectMask`
 *  (usePixelEditor.ts:3693-3699). */
function globalSelectMask(ctx: ToolContext, target: string | null, tolerance: number): Set<string> {
  const mask = new Set<string>();
  for (let y = 0; y < ctx.height; y++) {
    for (let x = 0; x < ctx.width; x++) {
      if (colorsMatch(ctx.getCell(x, y), target, tolerance)) mask.add(`${x},${y}`);
    }
  }
  return mask;
}

/** Which combine mode a click resolves to - ports the modifier/sticky-mode resolution inline in
 *  `onPointerDown`'s `magicWand` branch (usePixelEditor.ts:2518-2531). Exported so the engine can use
 *  the exact same resolution to decide whether a click routes into this tool at all, or into Move
 *  instead (a click inside the existing selection routes to Move *unless* it resolves to 'subtract' -
 *  see usePixelEditor.ts:2523-2531). NOT the same rule as `resolveMarqueeMode` (Select/Lasso) - Magic
 *  Wand treats Ctrl as 'add' and gives the sticky 'subtract' mode priority over a plain click; kept
 *  intentionally separate rather than unified. */
export function resolveWandCombine(e: ToolPointerEvent, selectionMode: SelectionMode): SelectionMode {
  if (e.altKey || selectionMode === 'subtract') return 'subtract';
  if (e.ctrlKey || selectionMode === 'add') return 'add';
  return 'new';
}

class MagicWandGesture implements Gesture {
  readonly kind = 'magicWand';
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

export function createMagicWandTool(): Tool {
  return {
    name: 'magicWand',
    beginGesture(e, ctx) {
      return new MagicWandGesture(applyWandClick(e, ctx));
    },
  };
}

function applyWandClick(e: ToolPointerEvent, ctx: ToolContext): GestureResult {
  const combine = resolveWandCombine(e, ctx.selectionMode);
  const global = e.shiftKey || !ctx.wandContiguous;
  const target = ctx.getCell(e.cell.x, e.cell.y);
  const clicked = global ? globalSelectMask(ctx, target, ctx.fillTolerance) : floodSelectMask(ctx, e.cell.x, e.cell.y, target, ctx.fillTolerance);
  const selection = settleSelection(clicked, combine, ctx);
  return { ops: [], dirtyRects: [], changed: false, selection };
}
