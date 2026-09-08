import type { CellColor, Layer, SelectionBox } from './types';
import { layersDiffRegion } from './pixelMath';

/**
 * Diff-based undo history for the pixel editor (see docs/EDITOR_IMPROVEMENTS.md #3).
 *
 * The editor used to keep undo/redo as full frame-stack snapshots - `structuredClone(frames)` per
 * step, where `frames` is `Layer[][]` and each layer a flat `CellColor[]` of `width*height`. On a
 * background-sized canvas (1400×900 × several layers) that is millions of cells per snapshot, held
 * ~50-deep on each of two stacks. Most edits touch one frame and usually a small region of it, so a
 * step is stored here as just the changed rectangle of the changed frame's layers (`'cells'`), and a
 * whole-snapshot pair (`'full'`) is the fallback for anything structural - a resize, a layer add, an
 * opacity change, a frame swap - where a region diff isn't safe.
 *
 * These are pure functions with no engine/DOM dependency so the round-trip logic can be unit-tested
 * directly (src/lib/__tests__/undoHistory.test.ts). The engine wiring lives in usePixelEditor.ts's
 * `// --- undo/redo ---` section.
 */

/** The full editor state an undo step may need to restore - the same shape as usePixelEditor's own
 *  `Snapshot` (which now aliases this), captured via `structuredClone` at the engine. */
export interface HistorySnapshot {
  frames: Layer[][];
  width: number;
  height: number;
  frameIndex: number;
  activeLayerIndex: number;
  frameMs: number;
}

/** One row-major slice per layer of a single frame, covering exactly `box` (inclusive), in layer
 *  order. `box` width is `x1 - x0 + 1`, height `y1 - y0 + 1`. */
export type RegionSlices = CellColor[][];

export type HistoryEntry =
  | {
      kind: 'cells';
      frameIndex: number;
      activeLayerIndex: number;
      box: SelectionBox;
      before: RegionSlices;
      after: RegionSlices;
    }
  | { kind: 'full'; before: HistorySnapshot; after: HistorySnapshot };

/** Returned by `buildHistoryEntry` when `before` and `after` are pixel- and structure-identical -
 *  the caller pushes nothing (a `pushUndo()` that turned out to bracket no change). */
export const NO_CHANGE = Symbol('undo-history-no-change');

function boxSize(box: SelectionBox): { w: number; h: number } {
  return { w: box.x1 - box.x0 + 1, h: box.y1 - box.y0 + 1 };
}

/** Copies `box` out of every layer's cell array into one flat row-major array per layer. */
export function sliceRegion(layers: Layer[], box: SelectionBox, width: number): RegionSlices {
  const { w, h } = boxSize(box);
  return layers.map((layer) => {
    const out: CellColor[] = new Array(w * h);
    for (let dy = 0; dy < h; dy++) {
      const srcRow = (box.y0 + dy) * width + box.x0;
      const dstRow = dy * w;
      for (let dx = 0; dx < w; dx++) out[dstRow + dx] = layer.cells[srcRow + dx];
    }
    return out;
  });
}

/** Writes previously-`sliceRegion`d data back into `box` of every layer's cell array, in place. */
export function applyRegion(layers: Layer[], box: SelectionBox, width: number, data: RegionSlices): void {
  const { w, h } = boxSize(box);
  layers.forEach((layer, li) => {
    const slice = data[li];
    if (!slice) return;
    for (let dy = 0; dy < h; dy++) {
      const dstRow = (box.y0 + dy) * width + box.x0;
      const srcRow = dy * w;
      for (let dx = 0; dx < w; dx++) layer.cells[dstRow + dx] = slice[srcRow + dx];
    }
  });
}

/** Whether the active frame's layer stack is structurally the same between two snapshots (so a
 *  region diff of its cells is meaningful). `layersDiffRegion` already rejects a different layer
 *  count / visibility / opacity / cell-length; this adds identity (id/name), which a rename or
 *  reorder changes without changing any pixel. */
function sameActiveLayerStructure(a: Layer[], b: Layer[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((la, i) => la.id === b[i].id && la.name === b[i].name);
}

function framesEqual(a: Layer[], b: Layer[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((la, i) => {
    const lb = b[i];
    if (la.id !== lb.id || la.name !== lb.name || la.visible !== lb.visible || la.opacity !== lb.opacity) return false;
    if (la.cells.length !== lb.cells.length) return false;
    return la.cells.every((c, ci) => c === lb.cells[ci]);
  });
}

/**
 * Builds the undo entry for an edit that took state from `before` to `after`.
 *
 * Returns a `'full'` entry whenever a region diff of the active frame isn't safe - canvas size,
 * `frameMs`, frame count, the active frame/layer index, the active frame's layer structure, or any
 * *other* frame changed. Otherwise diffs the active frame's cells: `NO_CHANGE` if identical, else a
 * `'cells'` entry holding just the changed rectangle of every layer, for both directions.
 */
export function buildHistoryEntry(before: HistorySnapshot, after: HistorySnapshot): HistoryEntry | typeof NO_CHANGE {
  const structural =
    before.width !== after.width ||
    before.height !== after.height ||
    before.frameMs !== after.frameMs ||
    before.frameIndex !== after.frameIndex ||
    before.activeLayerIndex !== after.activeLayerIndex ||
    before.frames.length !== after.frames.length;

  if (structural) return { kind: 'full', before, after };

  const fi = after.frameIndex;

  // Any change outside the active frame can't be captured by an active-frame region diff.
  for (let f = 0; f < before.frames.length; f++) {
    if (f === fi) continue;
    if (!framesEqual(before.frames[f], after.frames[f])) return { kind: 'full', before, after };
  }

  if (!sameActiveLayerStructure(before.frames[fi], after.frames[fi])) {
    return { kind: 'full', before, after };
  }

  const region = layersDiffRegion(before.frames[fi], after.frames[fi], after.width, after.height);
  if (region === null) return NO_CHANGE;
  if (region === 'full') return { kind: 'full', before, after };

  return {
    kind: 'cells',
    frameIndex: fi,
    activeLayerIndex: after.activeLayerIndex,
    box: region,
    before: sliceRegion(before.frames[fi], region, before.width),
    after: sliceRegion(after.frames[fi], region, after.width),
  };
}

/** Rough retained-bytes estimate for one entry, for the history memory budget (see `trimHistory`).
 *  ~2 bytes per cell reference is a deliberate under-count of a JS string ref + short color string;
 *  it only needs to be monotonic and roughly proportional, not exact. */
export function entryBytes(e: HistoryEntry): number {
  if (e.kind === 'cells') {
    const cells = e.before.reduce((n, s) => n + s.length, 0) * 2;
    return cells * 2 + 64;
  }
  return snapshotBytes(e.before) + snapshotBytes(e.after);
}

function snapshotBytes(s: HistorySnapshot): number {
  let cells = 0;
  for (const frame of s.frames) for (const layer of frame) cells += layer.cells.length;
  return cells * 2 + 64;
}

/** Count ceiling on undo/redo depth - diff entries are cheap, so this can stay generous. */
export const UNDO_MAX_STEPS = 80;
/** Never trim below this many steps, whatever the byte budget says - a large canvas whose every step
 *  is a `'full'` entry (e.g. repeated resizes) still keeps a usable history. */
export const UNDO_MIN_STEPS = 8;
/** Soft cap on total retained history bytes per stack. */
export const UNDO_BYTE_BUDGET = 32 * 1024 * 1024;

/** Drops oldest entries from `stack` (in place) until it's within both the step count ceiling and the
 *  byte budget (the latter never taking it below `UNDO_MIN_STEPS`). */
export function trimHistory(stack: HistoryEntry[]): void {
  while (stack.length > UNDO_MAX_STEPS) stack.shift();
  let total = stack.reduce((n, e) => n + entryBytes(e), 0);
  while (total > UNDO_BYTE_BUDGET && stack.length > UNDO_MIN_STEPS) {
    total -= entryBytes(stack[0]);
    stack.shift();
  }
}
