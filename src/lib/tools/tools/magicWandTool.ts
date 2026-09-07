import { hexToRgb } from '../../pixelMath';
import type { Cell, SelectionMode } from '../../types';
import type { Gesture, GestureResult, SelectionResult, Tool, ToolContext, ToolPointerEvent, ToolPreview } from '../types';

/** Ports `colorsMatch` (usePixelEditor.ts:3574-3582). */
function colorsMatch(a: string | null, b: string | null, tolerance: number): boolean {
  if (a === b) return true;
  if (tolerance <= 0 || a === null || b === null) return false;
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const dist = Math.sqrt((ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2);
  const maxDist = Math.sqrt(255 * 255 * 3);
  return (dist / maxDist) * 100 <= tolerance;
}

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

function boundingBoxOfMask(mask: ReadonlySet<string>): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  mask.forEach((key) => {
    const [xs, ys] = key.split(',');
    const x = Number(xs);
    const y = Number(ys);
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  });
  return { x0, y0, x1, y1 };
}

/** Every unit boundary edge of a cell mask - ports `maskBoundaryEdges` (usePixelEditor.ts:3743-3755). */
function maskBoundaryEdges(mask: ReadonlySet<string>): { from: Cell; to: Cell }[] {
  const edges: { from: Cell; to: Cell }[] = [];
  mask.forEach((key) => {
    const [xs, ys] = key.split(',');
    const x = Number(xs);
    const y = Number(ys);
    if (!mask.has(`${x},${y - 1}`)) edges.push({ from: { x, y }, to: { x: x + 1, y } });
    if (!mask.has(`${x + 1},${y}`)) edges.push({ from: { x: x + 1, y }, to: { x: x + 1, y: y + 1 } });
    if (!mask.has(`${x},${y + 1}`)) edges.push({ from: { x: x + 1, y: y + 1 }, to: { x, y: y + 1 } });
    if (!mask.has(`${x - 1},${y}`)) edges.push({ from: { x, y: y + 1 }, to: { x, y } });
  });
  return edges;
}

/** Chains boundary edges into closed loops - ports `chainBoundaryEdges` (usePixelEditor.ts:3768-3793). */
function chainBoundaryEdges(edges: { from: Cell; to: Cell }[]): Cell[][] {
  const byStart = new Map<string, { from: Cell; to: Cell }[]>();
  edges.forEach((e) => {
    const key = `${e.from.x},${e.from.y}`;
    const list = byStart.get(key);
    if (list) list.push(e);
    else byStart.set(key, [e]);
  });
  const used = new Set<{ from: Cell; to: Cell }>();
  const loops: Cell[][] = [];
  edges.forEach((start) => {
    if (used.has(start)) return;
    const loop: Cell[] = [];
    let current = start;
    while (!used.has(current)) {
      used.add(current);
      loop.push(current.from);
      const candidates = byStart.get(`${current.to.x},${current.to.y}`) ?? [];
      const next = candidates.find((e) => !used.has(e));
      if (!next) break;
      current = next;
    }
    loops.push(loop);
  });
  return loops;
}

/** Stitches every boundary loop into one closed point list - ports `traceMaskOutline`
 *  (usePixelEditor.ts:3815-3822). */
function traceMaskOutline(mask: ReadonlySet<string>): Cell[] {
  const loops = chainBoundaryEdges(maskBoundaryEdges(mask)).filter((loop) => loop.length > 0);
  if (loops.length <= 1) return loops[0] ?? [];
  const hub = loops[0][0];
  const path: Cell[] = [...loops[0], hub];
  for (let i = 1; i < loops.length; i++) path.push(...loops[i], loops[i][0], hub);
  return path;
}

/** Even-odd fill of a closed point list back into a cell mask - ports `polygonMask`
 *  (usePixelEditor.ts:2016-2038), used here only to verify `traceMaskOutline` round-trips (see
 *  applySelectionMask's own doc comment, usePixelEditor.ts:3838-3843, for the one case it can't). */
function polygonMask(pts: Cell[]): Set<string> {
  const box = boundingBoxOfMask(new Set(pts.map((p) => `${p.x},${p.y}`)));
  const mask = new Set<string>();
  for (let y = box.y0; y <= box.y1; y++) {
    const cy = y + 0.5;
    const crossings: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (a.y === b.y) continue;
      if ((cy >= a.y && cy < b.y) || (cy >= b.y && cy < a.y)) {
        crossings.push(a.x + ((cy - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
    }
    crossings.sort((m, n) => m - n);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const xStart = Math.max(box.x0, Math.ceil(crossings[i] - 0.5));
      const xEnd = Math.min(box.x1, Math.floor(crossings[i + 1] - 0.5));
      for (let x = xStart; x <= xEnd; x++) mask.add(`${x},${y}`);
    }
  }
  return mask;
}

function masksEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const key of a) if (!b.has(key)) return false;
  return true;
}

/** Materializes the current selection as an explicit mask - ports `maskFromSelection`
 *  (usePixelEditor.ts:3705-3712). */
function maskFromSelection(ctx: ToolContext): Set<string> {
  if (ctx.selectionMask) return new Set(ctx.selectionMask);
  const mask = new Set<string>();
  if (!ctx.selection) return mask;
  const { x0, y0, x1, y1 } = ctx.selection;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) mask.add(`${x},${y}`);
  return mask;
}

/** Which combine mode a click resolves to - ports the modifier/sticky-mode resolution inline in
 *  `onPointerDown`'s `magicWand` branch (usePixelEditor.ts:2518-2531). Exported so the engine can use
 *  the exact same resolution to decide whether a click routes into this tool at all, or into Move
 *  instead (a click inside the existing selection routes to Move *unless* it resolves to 'subtract' -
 *  see usePixelEditor.ts:2523-2531). */
export function resolveWandCombine(e: ToolPointerEvent, selectionMode: SelectionMode): SelectionMode {
  if (e.altKey || selectionMode === 'subtract') return 'subtract';
  if (e.ctrlKey || selectionMode === 'add') return 'add';
  return 'new';
}

/** Merges a freshly made mask into the existing selection per `combine`, then settles the result into
 *  the box/mask/outline trio the rest of the selection machinery reads - ports `applySelectionMask`
 *  (usePixelEditor.ts:3869-3901), including collapsing a mask that exactly fills its own bounding box
 *  back into a plain rectangle (no mask) the same way. */
function settleSelection(clicked: ReadonlySet<string>, combine: SelectionMode, ctx: ToolContext): SelectionResult {
  let mask: Set<string>;
  if (combine === 'add') {
    mask = maskFromSelection(ctx);
    clicked.forEach((key) => mask.add(key));
  } else if (combine === 'subtract') {
    mask = maskFromSelection(ctx);
    clicked.forEach((key) => mask.delete(key));
  } else {
    mask = new Set(clicked);
  }

  if (mask.size === 0) return { box: null, mask: null, outline: null };

  const box = boundingBoxOfMask(mask);
  if (mask.size === (box.x1 - box.x0 + 1) * (box.y1 - box.y0 + 1)) {
    return { box, mask: null, outline: null };
  }
  const outline = traceMaskOutline(mask);
  const roundTrips = outline.length > 0 && masksEqual(polygonMask(outline), mask);
  return { box, mask, outline: roundTrips ? outline : null };
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
