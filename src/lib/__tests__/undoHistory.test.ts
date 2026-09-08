import { describe, expect, it } from 'vitest';
import type { CellColor, Layer } from '../types';
import {
  NO_CHANGE,
  UNDO_MIN_STEPS,
  applyRegion,
  buildHistoryEntry,
  entryBytes,
  sliceRegion,
  trimHistory,
  type HistoryEntry,
  type HistorySnapshot,
} from '../undoHistory';

const W = 4;
const H = 4;

function layer(id: string, cells: CellColor[], extra: Partial<Layer> = {}): Layer {
  return { id, name: id, visible: true, opacity: 1, cells: [...cells], ...extra };
}

/** A blank W×H layer stack with `n` layers. */
function blankFrame(n = 1): Layer[] {
  return Array.from({ length: n }, (_, i) => layer(`L${i}`, new Array(W * H).fill(null)));
}

function snap(frames: Layer[][], over: Partial<HistorySnapshot> = {}): HistorySnapshot {
  return {
    frames,
    width: W,
    height: H,
    frameIndex: 0,
    activeLayerIndex: 0,
    frameMs: 100,
    ...over,
  };
}

/** Deep-ish clone so mutating one snapshot's frames can't touch another. */
function clone(s: HistorySnapshot): HistorySnapshot {
  return { ...s, frames: s.frames.map((f) => f.map((l) => ({ ...l, cells: [...l.cells] }))) };
}

/** buildHistoryEntry result, asserted to be a real entry (not the NO_CHANGE sentinel). */
function entryOf(before: HistorySnapshot, after: HistorySnapshot): HistoryEntry {
  const e = buildHistoryEntry(before, after);
  if (e === NO_CHANGE) throw new Error('expected a history entry, got NO_CHANGE');
  return e;
}

describe('sliceRegion / applyRegion', () => {
  it('round-trips a sub-rectangle of every layer', () => {
    const cells = new Array(W * H).fill(null).map((_, i) => `c${i}`);
    const layers = [layer('a', cells), layer('b', cells.map((c) => c + 'x'))];
    const box = { x0: 1, y0: 1, x1: 2, y1: 2 };

    const sliced = sliceRegion(layers, box, W);
    expect(sliced).toHaveLength(2);
    expect(sliced[0]).toEqual(['c5', 'c6', 'c9', 'c10']);

    const target = [layer('a', new Array(W * H).fill(null)), layer('b', new Array(W * H).fill(null))];
    applyRegion(target, box, W, sliced);
    expect(target[0].cells[5]).toBe('c5');
    expect(target[0].cells[10]).toBe('c10');
    expect(target[1].cells[6]).toBe('c6x');
    // outside the box is untouched
    expect(target[0].cells[0]).toBeNull();
    expect(target[0].cells[15]).toBeNull();
  });
});

describe('buildHistoryEntry - cells diff', () => {
  it('captures a small single-layer change as a cells entry over just the changed box', () => {
    const before = snap([blankFrame(1)]);
    const after = clone(before);
    after.frames[0][0].cells[5] = '#f00';
    after.frames[0][0].cells[6] = '#0f0';

    const entry = entryOf(before, after);
    if (entry.kind !== 'cells') throw new Error('expected cells entry');
    expect(entry.box).toEqual({ x0: 1, y0: 1, x1: 2, y1: 1 });
    expect(entry.frameIndex).toBe(0);
  });

  it('round-trips: applying before / after reproduces each state exactly', () => {
    const before = snap([blankFrame(2)]);
    const after = clone(before);
    after.frames[0][1].cells[10] = '#abc';

    const entry = entryOf(before, after);
    if (entry.kind !== 'cells') throw new Error('expected cells entry');

    // start from `after`, apply the inverse slice -> should equal `before`
    const work = clone(after).frames[0];
    applyRegion(work, entry.box, W, entry.before);
    expect(work.map((l) => l.cells)).toEqual(before.frames[0].map((l) => l.cells));

    // then apply the forward slice -> back to `after`
    applyRegion(work, entry.box, W, entry.after);
    expect(work.map((l) => l.cells)).toEqual(after.frames[0].map((l) => l.cells));
  });

  it('identical states -> NO_CHANGE (nothing to push)', () => {
    const before = snap([blankFrame(1)]);
    expect(buildHistoryEntry(before, clone(before))).toBe(NO_CHANGE);
  });
});

describe('buildHistoryEntry - full fallback', () => {
  const base = () => snap([blankFrame(1)]);

  it('canvas resize', () => {
    const after = clone(base());
    after.width = 8;
    expect(entryOf(base(), after).kind).toBe('full');
  });

  it('frameMs change', () => {
    const after = clone(base());
    after.frameMs = 200;
    expect(entryOf(base(), after).kind).toBe('full');
  });

  it('active frame / layer index change', () => {
    const twoFrames = () => snap([blankFrame(1), blankFrame(1)]);
    const after = clone(twoFrames());
    after.frameIndex = 1;
    expect(entryOf(twoFrames(), after).kind).toBe('full');
  });

  it('layer added / removed', () => {
    const after = clone(base());
    after.frames[0].push(layer('L1', new Array(W * H).fill(null)));
    expect(entryOf(base(), after).kind).toBe('full');
  });

  it('layer opacity / visibility change', () => {
    const afterOpacity = clone(base());
    afterOpacity.frames[0][0].opacity = 0.5;
    expect(entryOf(base(), afterOpacity).kind).toBe('full');

    const afterVis = clone(base());
    afterVis.frames[0][0].visible = false;
    expect(entryOf(base(), afterVis).kind).toBe('full');
  });

  it('layer rename / reorder (same pixels, different identity)', () => {
    const after = clone(base());
    after.frames[0][0].name = 'renamed';
    expect(entryOf(base(), after).kind).toBe('full');
  });

  it('a change on a non-active frame', () => {
    const twoFrames = () => snap([blankFrame(1), blankFrame(1)]);
    const after = clone(twoFrames());
    after.frames[1][0].cells[0] = '#111';
    expect(entryOf(twoFrames(), after).kind).toBe('full');
  });
});

describe('trimHistory', () => {
  function cellsEntry(px: number): HistoryEntry {
    const slice = new Array(px).fill('#000');
    return {
      kind: 'cells',
      frameIndex: 0,
      activeLayerIndex: 0,
      box: { x0: 0, y0: 0, x1: px - 1, y1: 0 },
      before: [slice],
      after: [slice],
    };
  }

  it('enforces the step-count ceiling', () => {
    const stack = Array.from({ length: 200 }, () => cellsEntry(1));
    trimHistory(stack);
    expect(stack.length).toBeLessThanOrEqual(80);
  });

  it('drops oldest entries past the byte budget but never below UNDO_MIN_STEPS', () => {
    // each ~8MB -> a handful blows the 32MB budget
    const huge = () => cellsEntry(2_000_000);
    const stack = Array.from({ length: 20 }, huge);
    trimHistory(stack);
    expect(stack.length).toBe(UNDO_MIN_STEPS);
  });

  it('entryBytes grows with region size', () => {
    expect(entryBytes(cellsEntry(1000))).toBeGreaterThan(entryBytes(cellsEntry(10)));
  });
});
