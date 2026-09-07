import type { Cell, SelectionBox, SelectionMode } from '../types';
import type { SelectionResult, ToolContext, ToolPointerEvent } from './types';

/** Bounding box of a sparse `"x,y"` cell mask - ports `boundingBoxOfMask`
 *  (usePixelEditor.ts:3716-3728). Shared by Magic Wand, Select (add/subtract) and Lasso. */
export function boundingBoxOfMask(mask: ReadonlySet<string>): SelectionBox {
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
export function maskBoundaryEdges(mask: ReadonlySet<string>): { from: Cell; to: Cell }[] {
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
export function chainBoundaryEdges(edges: { from: Cell; to: Cell }[]): Cell[][] {
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
export function traceMaskOutline(mask: ReadonlySet<string>): Cell[] {
  const loops = chainBoundaryEdges(maskBoundaryEdges(mask)).filter((loop) => loop.length > 0);
  if (loops.length <= 1) return loops[0] ?? [];
  const hub = loops[0][0];
  const path: Cell[] = [...loops[0], hub];
  for (let i = 1; i < loops.length; i++) path.push(...loops[i], loops[i][0], hub);
  return path;
}

/** Even-odd fill of a closed point list back into a cell mask - ports `polygonMask`
 *  (usePixelEditor.ts:2016-2038). Used both to verify `traceMaskOutline` round-trips and, by Lasso, to
 *  turn a freehand path directly into a selection mask. */
export function polygonMask(pts: Cell[]): Set<string> {
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

export function masksEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const key of a) if (!b.has(key)) return false;
  return true;
}

/** Materializes the current selection as an explicit mask - ports `maskFromSelection`
 *  (usePixelEditor.ts:3705-3712). */
export function maskFromSelection(ctx: ToolContext): Set<string> {
  if (ctx.selectionMask) return new Set(ctx.selectionMask);
  const mask = new Set<string>();
  if (!ctx.selection) return mask;
  const { x0, y0, x1, y1 } = ctx.selection;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) mask.add(`${x},${y}`);
  return mask;
}

/** Every cell of a rectangular box as a mask - ports `rectMask` (usePixelEditor.ts:4057-4063), used by
 *  Select's add/subtract combine (a plain 'new' marquee stays a mask-less rectangle, the cheap common
 *  case - see settleSelection's own doc comment for why a mask filling its own bbox collapses back to
 *  one anyway). */
export function rectMask(box: SelectionBox): Set<string> {
  const mask = new Set<string>();
  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) mask.add(`${x},${y}`);
  }
  return mask;
}

/** Which combine mode a click/drag resolves to - the modifier/sticky-mode resolution shared verbatim
 *  by Magic Wand, Select and Lasso (`altKey ? 'subtract' : shiftKey ? 'add' : selectionMode`,
 *  usePixelEditor.ts:2518/2711/2714/2729 - Magic Wand additionally treats Ctrl as 'add', see
 *  `resolveWandCombine` in magicWandTool.ts, which is NOT the same rule and is kept separate). */
export function resolveMarqueeMode(e: ToolPointerEvent, selectionMode: SelectionMode): SelectionMode {
  if (e.altKey) return 'subtract';
  if (e.shiftKey) return 'add';
  return selectionMode;
}

/** Merges a freshly made mask into the existing selection per `combine`, then settles the result into
 *  the box/mask/outline trio the rest of the selection machinery reads - ports `applySelectionMask`
 *  (usePixelEditor.ts:3869-3901), including collapsing a mask that exactly fills its own bounding box
 *  back into a plain rectangle (no mask) the same way. Shared by Magic Wand and Lasso; Select's own
 *  'new' mode bypasses this entirely (see selectTool.ts - a plain marquee never needs mask machinery). */
export function settleSelection(clicked: ReadonlySet<string>, combine: SelectionMode, ctx: ToolContext): SelectionResult {
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
