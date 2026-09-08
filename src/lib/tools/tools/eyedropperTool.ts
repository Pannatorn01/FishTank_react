import type { Gesture, GestureResult, Tool, ToolPreview } from '../types';

/**
 * Instant color-pick gesture - ports the 'eyedropper' branch of onPointerDown (usePixelEditor.ts:
 * 2667-2670) and `pickColor` (:3587-3600). All the work happens in `beginGesture` (same "instant
 * action" shape as MagicWand/Fill) - `onPointerMove` never fires anything, `onPointerUp` just replays
 * the precomputed result. Never touches a pixel or pushes an undo entry.
 */
class EyedropperGesture implements Gesture {
  readonly kind = 'eyedropper';
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

export function createEyedropperTool(): Tool {
  return {
    name: 'eyedropper',
    beginGesture(e, ctx) {
      const sampled = ctx.getVisibleColor(e.cell.x, e.cell.y);
      const result: GestureResult =
        sampled !== null
          ? { ops: [], dirtyRects: [], changed: false, pickedColor: sampled, switchToPen: true }
          : { ops: [], dirtyRects: [], changed: false };
      return new EyedropperGesture(result);
    },
  };
}
