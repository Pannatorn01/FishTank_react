import type { Cell, SelectionBox, SelectionMode } from '../types';
import type { SelectionResult, ToolPointerEvent } from './types';

/** The two things every operation here needs to know about the *existing* selection: its bounding
 *  box, and (for a freeform lasso/Magic-Wand selection) which cells inside that box are actually
 *  selected. Deliberately narrower than ToolContext so the engine can be passed directly too - both
 *  a ToolContext and a PixelEditorEngine satisfy it structurally, which is what lets the engine's own
 *  selection ops share this module instead of keeping a second copy of it. */
export interface SelectionState {
  selection: SelectionBox | null;
  selectionMask: ReadonlySet<string> | null;
}

/** Bounding box of a sparse `"x,y"` cell mask - the settled selection's `selection` box. Shared by
 *  Magic Wand, Select (add/subtract) and Lasso. */
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

/**
 * Every unit boundary edge of a cell mask, in grid-line coordinates (0..width/height - the corner
 * where cell (x,y)'s own corners sit, not a cell index) rather than cell coordinates: polygonMask
 * decides whether cell (x,y) is selected by checking whether its *center* (x+0.5, y+0.5) falls
 * inside the traced polygon, so a polygon built from cell coordinates directly (as if the boundary
 * cells themselves were the vertices) ends up exactly one cell short on the far/bottom side of
 * whatever it encloses - confirmed by tracing a plain 2x2 block that way and finding polygonMask
 * reconstructs only 1 of the 4 cells. Emitting the actual grid-line corner each boundary side sits
 * on (one cell over from the boundary cell itself, on the appropriate side) is what makes
 * polygonMask reconstruct the exact original mask - verified the same way, this time getting all 4
 * cells back. The engine's selectionLassoOutline renders these points as-is, with no half-cell
 * offset, so the border drawn from them sits exactly on the boundary pixels' outer edges.
 */
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

/**
 * Chains maskBoundaryEdges' unordered edge soup into closed loops by following each edge's `to`
 * point to the next edge that starts there. Every vertex on a raster mask's boundary has exactly one
 * outgoing and one incoming edge by construction (each grid-line segment is the border of exactly
 * one boundary cell on the selected side), so this always resolves into whole simple closed loops
 * with nothing left over: one per outer silhouette, and - for free, needing no special-casing - one
 * per interior hole, automatically wound the opposite way round (an unselected cell's neighbors emit
 * their shared edges in the mirror-image direction of an outer boundary), which is exactly what lets
 * an even-odd fill (see polygonMask) or the default nonzero SVG fill rule render/reconstruct a hole
 * as a hole rather than filled-in.
 */
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

/**
 * Combines every boundary loop (see chainBoundaryEdges - an outer silhouette plus any holes, or
 * several disjoint loops for a global Shift+click match spanning multiple blobs) into the single
 * closed point list a lasso outline expects. A single loop is used as-is; two or more are stitched
 * into one path via "keyhole" bridges radiating from the first loop's own start point (the "hub"):
 * each other loop is spliced in as its own closed lap, entered and exited through the exact same hub
 * point (bridging every extra loop through one shared hub, rather than threading loop 1 -> 2 -> 3 ->
 * ... -> back to 1, is what makes this generalize to any number of loops instead of just two).
 *
 * In principle a bridge edge, walked once out and once back, contributes either zero or two
 * scanline crossings at any given y in polygonMask's even-odd count, which cancels out and renders
 * as an invisible zero-width seam - and that holds up whenever the bridge only ever passes through
 * rows where the real geometry it's bridging also has crossings of its own (true for a hole, always
 * inside its own outer loop's row span). It does NOT reliably hold for two loops separated by rows
 * neither one touches (a global Shift+click match spanning genuinely disjoint blobs): the bridge's
 * pair of identical, coincident crossings on an otherwise-empty row can misround into a spurious
 * 1-cell-wide sliver (confirmed by reconstructing a two-disjoint-2x2-blocks case this way and getting
 * 11 cells back instead of 8). settleSelection verifies the round trip and discards the outline
 * rather than risk that, so this function itself doesn't need to tell the safe and unsafe cases apart.
 */
export function traceMaskOutline(mask: ReadonlySet<string>): Cell[] {
  const loops = chainBoundaryEdges(maskBoundaryEdges(mask)).filter((loop) => loop.length > 0);
  if (loops.length <= 1) return loops[0] ?? [];
  const hub = loops[0][0];
  const path: Cell[] = [...loops[0], hub];
  for (let i = 1; i < loops.length; i++) path.push(...loops[i], loops[i][0], hub);
  return path;
}

/** Even-odd scanline fill of the closed polygon `pts` describes (auto-closed from the last point back
 *  to the first), sampled at each cell's center - the standard way to turn a freehand lasso path into
 *  the set of cells it actually encloses. Bounded to the polygon's own bounding box, not the whole
 *  canvas, since a selection is typically a small fraction of a large one. Used both to verify
 *  `traceMaskOutline` round-trips and, by Lasso, to turn a freehand path directly into a mask. */
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

/** Materializes the current selection as an explicit mask - a plain rectangular marquee (no
 *  `selectionMask`) expands into every cell of its own box. */
export function maskFromSelection(ctx: SelectionState): Set<string> {
  if (ctx.selectionMask) return new Set(ctx.selectionMask);
  const mask = new Set<string>();
  if (!ctx.selection) return mask;
  const { x0, y0, x1, y1 } = ctx.selection;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) mask.add(`${x},${y}`);
  return mask;
}

/** Every cell of a rectangular box as a mask - used by
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
 *  by Magic Wand, Select and Lasso (`altKey ? 'subtract' : shiftKey ? 'add' : selectionMode`) - Magic
 *  Wand additionally treats Ctrl as 'add', see `resolveWandCombine` in magicWandTool.ts, which is NOT
 *  the same rule and is kept separate. */
export function resolveMarqueeMode(e: ToolPointerEvent, selectionMode: SelectionMode): SelectionMode {
  if (e.altKey) return 'subtract';
  if (e.shiftKey) return 'add';
  return selectionMode;
}

/** Merges a freshly made mask into whatever is already selected per `combine`, then settles the result
 *  into the box/mask/outline trio the overlay and every selection-aware operation read - so "add to the
 *  selection" means the same thing, and produces the same kind of selection, whichever tool drew the
 *  new piece. Shared by Magic Wand, Lasso and the engine's own rotate commit; Select's 'new' mode
 *  bypasses this entirely (see selectTool.ts - a plain marquee never needs mask machinery). */
export function settleSelection(clicked: ReadonlySet<string>, combine: SelectionMode, ctx: SelectionState): SelectionResult {
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
  // A mask that fills its own bounding box completely *is* a plain rectangular marquee, so it is
  // returned as one: no per-cell mask to carry around, and the resize handles (which only render for a
  // rectangle - see the engine's selectionOverlayBox) stay available. Rotating a rectangle by a
  // multiple of 90 degrees lands here, as does a Magic Wand click on a rectangular block of color.
  if (mask.size === (box.x1 - box.x0 + 1) * (box.y1 - box.y0 + 1)) {
    return { box, mask: null, outline: null };
  }
  const outline = traceMaskOutline(mask);
  const roundTrips = outline.length > 0 && masksEqual(polygonMask(outline), mask);
  return { box, mask, outline: roundTrips ? outline : null };
}

/** Translates every cell of a sparse `"x,y"` selection mask by (dx, dy) - the precise, shape-agnostic
 *  counterpart to shifting a lasso outline and re-deriving the mask via polygonMask, used when there
 *  is no outline to shift instead (a Magic Wand selection whose mask couldn't be safely represented
 *  as one traced+bridged polygon - see traceMaskOutline's own doc comment). */
export function shiftMask(mask: ReadonlySet<string>, dx: number, dy: number): Set<string> {
  const shifted = new Set<string>();
  mask.forEach((key) => {
    const [xs, ys] = key.split(',');
    shifted.add(`${Number(xs) + dx},${Number(ys) + dy}`);
  });
  return shifted;
}
