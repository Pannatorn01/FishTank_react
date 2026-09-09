import { describe, expect, it } from 'vitest';
import { createMagicWandTool, resolveWandCombine } from '../tools/magicWandTool';
import { makeContext, makeFrame, ptr } from './testUtils';

describe('resolveWandCombine', () => {
  it('alt-click always resolves to subtract, even with an add-sticky mode', () => {
    expect(resolveWandCombine(ptr(0, 0, { altKey: true }), 'add')).toBe('subtract');
  });
  it('ctrl-click resolves to add', () => {
    expect(resolveWandCombine(ptr(0, 0, { ctrlKey: true }), 'new')).toBe('add');
  });
  it('a plain click under sticky "new" mode resolves to new', () => {
    expect(resolveWandCombine(ptr(0, 0), 'new')).toBe('new');
  });
});

// R R B
// R B B
// B B B
// - an L-shaped red region so its bounding box (2x2) doesn't exactly match its cell count (3), which
//   keeps the selection as a real sparse mask instead of collapsing to a plain rectangle (see
//   settleSelection's own doc comment) - needed to actually exercise mask contents in these tests.
function lShapeFrame() {
  return makeFrame(3, 3, (x, y) => {
    if (x === 2 || y === 2) return '#0000ff';
    if (x === 1 && y === 1) return '#0000ff';
    return '#ff0000';
  });
}

describe('MagicWandTool', () => {
  it('contiguous select reaches only the connected same-color blob', () => {
    const ctx = makeContext(lShapeFrame());
    const tool = createMagicWandTool();
    const result = tool.beginGesture(ptr(0, 0), ctx)!.onPointerUp(ptr(0, 0), ctx);
    expect([...(result.selection!.mask ?? [])].sort()).toEqual(['0,0', '0,1', '1,0']);
  });

  it('global (shift) selects every matching cell regardless of adjacency', () => {
    // 3x1: red, blue, red - a plain click only reaches the clicked cell (blocked by blue), Shift
    // reaches both reds even though they are not contiguous.
    const frame = makeFrame(3, 1, (x) => (x === 1 ? '#0000ff' : '#ff0000'));
    const ctx = makeContext(frame);
    const tool = createMagicWandTool();

    const plain = tool.beginGesture(ptr(0, 0), ctx)!.onPointerUp(ptr(0, 0), ctx);
    expect(plain.selection?.box).toEqual({ x0: 0, y0: 0, x1: 0, y1: 0 });

    const global = tool.beginGesture(ptr(0, 0, { shiftKey: true }), ctx)!.onPointerUp(ptr(0, 0, { shiftKey: true }), ctx);
    expect([...(global.selection!.mask ?? [])].sort()).toEqual(['0,0', '2,0']);
  });

  it('tolerance > 0 includes near-but-not-exact colors', () => {
    const frame = makeFrame(2, 1, (x) => (x === 0 ? '#000000' : '#020202'));
    const zeroTol = makeContext(frame, { fillTolerance: 0 });
    const withTol = makeContext(frame, { fillTolerance: 50 });
    const tool = createMagicWandTool();

    const strict = tool.beginGesture(ptr(0, 0), zeroTol)!.onPointerUp(ptr(0, 0), zeroTol);
    expect(strict.selection?.box).toEqual({ x0: 0, y0: 0, x1: 0, y1: 0 });

    const loose = tool.beginGesture(ptr(0, 0), withTol)!.onPointerUp(ptr(0, 0), withTol);
    expect(loose.selection?.box).toEqual({ x0: 0, y0: 0, x1: 1, y1: 0 });
  });

  it('shift/ctrl adds to the existing selection, alt subtracts from it', () => {
    const frame = lShapeFrame();
    const tool = createMagicWandTool();

    const base = makeContext(frame);
    const first = tool.beginGesture(ptr(0, 0), base)!.onPointerUp(ptr(0, 0), base);
    expect([...(first.selection!.mask ?? [])].sort()).toEqual(['0,0', '0,1', '1,0']);

    // (2,2) is blue - clicking it alone selects the whole (also L-shaped) blue region; ctrl unions it
    // into the existing red selection. Together the two L-shapes cover the entire 3x3 grid, which
    // exactly fills its own bounding box - so this also exercises the mask-collapses-to-rectangle path
    // (see settleSelection's own doc comment).
    const addCtx = makeContext(frame, { selection: first.selection!.box, selectionMask: first.selection!.mask });
    const added = tool.beginGesture(ptr(2, 2, { ctrlKey: true }), addCtx)!.onPointerUp(ptr(2, 2, { ctrlKey: true }), addCtx);
    expect(added.selection?.mask).toBeNull();
    expect(added.selection?.box).toEqual({ x0: 0, y0: 0, x1: 2, y1: 2 });

    // Alt-subtract at (1,0) (red) removes the contiguous red L-shape {0,0 1,0 0,1} from the now-full
    // selection, leaving the blue region behind.
    const subCtx = makeContext(frame, { selection: added.selection!.box, selectionMask: added.selection!.mask });
    const subtracted = tool.beginGesture(ptr(1, 0, { altKey: true }), subCtx)!.onPointerUp(ptr(1, 0, { altKey: true }), subCtx);
    expect([...(subtracted.selection!.mask ?? [])]).not.toContain('1,0');
    expect([...(subtracted.selection!.mask ?? [])]).not.toContain('0,0');
    expect([...(subtracted.selection!.mask ?? [])]).toContain('2,2');
  });

  it('never emits paint ops or a pushed-undo change flag - selection only', () => {
    const ctx = makeContext(lShapeFrame());
    const tool = createMagicWandTool();
    const result = tool.beginGesture(ptr(0, 0), ctx)!.onPointerUp(ptr(0, 0), ctx);
    expect(result.ops).toEqual([]);
    expect(result.changed).toBe(false);
  });
});
