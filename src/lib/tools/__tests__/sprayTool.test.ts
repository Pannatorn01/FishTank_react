import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSprayTool } from '../tools/sprayTool';
import { makeContext, makeFrame } from './testUtils';
import type { ToolPointerEvent } from '../types';

function ptr(x: number, y: number, extra: Partial<ToolPointerEvent> = {}): ToolPointerEvent {
  return { cell: { x, y }, shiftKey: false, altKey: false, ctrlKey: false, button: 0, ...extra };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SprayTool', () => {
  it('onPointerMove scatters dots immediately (paints on every move, not just on a timer tick)', () => {
    // Math.random -> 0 for both the angle and radius draws collapses every dot onto the exact center
    // cell (angle 0, radius 0), making the scatter deterministic to assert against.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const ctx = makeContext(makeFrame(10, 10)); // brushSize 1, sprayDensity 1 -> radius 2, dots = 2
    const tool = createSprayTool();
    const gesture = tool.beginGesture(ptr(5, 5), ctx)!;
    const preview = gesture.onPointerMove(ptr(5, 5), ctx)!;
    expect(preview.ops).toEqual([
      { x: 5, y: 5, color: '#ff0000' },
      { x: 5, y: 5, color: '#ff0000' },
    ]);
  });

  it('dot count scales with brushSize and sprayDensity (radius = brushSize + 1, dots = round(radius * density))', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const ctx = makeContext(makeFrame(10, 10), { brushSize: 4, sprayDensity: 2 }); // radius 5, dots = 10
    const tool = createSprayTool();
    const gesture = tool.beginGesture(ptr(5, 5), ctx)!;
    const preview = gesture.onPointerMove(ptr(5, 5), ctx)!;
    expect(preview.ops!.length).toBe(10);
  });

  it('right-click erases (color null)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const ctx = makeContext(makeFrame(10, 10));
    const tool = createSprayTool();
    const gesture = tool.beginGesture(ptr(5, 5, { button: 2 }), ctx)!;
    const preview = gesture.onPointerMove(ptr(5, 5, { button: 2 }), ctx)!;
    expect(preview.ops!.every((op) => op.color === null)).toBe(true);
  });

  it('dither mode picks exactly the primary or secondary color for every dot, never a blended hex', () => {
    const ctx = makeContext(makeFrame(20, 20), { brushSize: 8, ditherEnabled: true }); // wide radius, many dots
    const tool = createSprayTool();
    const gesture = tool.beginGesture(ptr(10, 10), ctx)!;
    const preview = gesture.onPointerMove(ptr(10, 10), ctx)!;
    preview.ops!.forEach((op) => expect(['#ff0000', '#0000ff']).toContain(op.color));
  });

  it('a selection restricts dots to inside it', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // every dot lands exactly on (5,5)
    const ctx = makeContext(makeFrame(10, 10), { selection: { x0: 0, y0: 0, x1: 2, y1: 2 } });
    const tool = createSprayTool();
    const gesture = tool.beginGesture(ptr(5, 5), ctx)!;
    const preview = gesture.onPointerMove(ptr(5, 5), ctx)!;
    expect(preview.ops).toEqual([]); // (5,5) is outside the 0-2/0-2 selection box
  });

  it('mirrors dots through symmetry with one shared color per mirror set (not independent per-mirror colors)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // every dot lands exactly on the clicked cell
    const ctx = makeContext(makeFrame(10, 10), { symmetry: 'vertical', symmetryAxisX: 5, symmetryAxisY: 5, brushSize: 1, sprayDensity: 0.5 });
    // radius = 2, dots = max(1, round(2*0.5)) = 1 -> exactly one dot, mirrored once.
    const tool = createSprayTool();
    const gesture = tool.beginGesture(ptr(2, 5), ctx)!;
    const preview = gesture.onPointerMove(ptr(2, 5), ctx)!;
    expect(preview.ops).toEqual([
      { x: 2, y: 5, color: '#ff0000' },
      { x: 7, y: 5, color: '#ff0000' },
    ]);
  });

  it('onTick scatters around the last position reported by onPointerMove, not the original beginGesture cell', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const ctx = makeContext(makeFrame(10, 10));
    const tool = createSprayTool();
    const gesture = tool.beginGesture(ptr(1, 1), ctx)!;
    gesture.onPointerMove(ptr(7, 7), ctx); // pointer has since moved away from the start cell
    const tick = gesture.onTick!(ctx)!;
    expect(tick.ops!.every((op) => op.x === 7 && op.y === 7)).toBe(true);
  });

  it('onPointerUp paints nothing further and always reports changed (the original never rolls back a spray gesture)', () => {
    const ctx = makeContext(makeFrame(10, 10));
    const tool = createSprayTool();
    const gesture = tool.beginGesture(ptr(5, 5), ctx)!;
    const result = gesture.onPointerUp(ptr(5, 5), ctx);
    expect(result.ops).toEqual([]);
    expect(result.changed).toBe(true);
  });

  it('onCancel reports no changes', () => {
    const ctx = makeContext(makeFrame(10, 10));
    const tool = createSprayTool();
    const gesture = tool.beginGesture(ptr(5, 5), ctx)!;
    expect(gesture.onCancel(ctx)).toEqual({ ops: [], dirtyRects: [], changed: false, cancelled: true });
  });
});
