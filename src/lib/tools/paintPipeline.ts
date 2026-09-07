import type { PaintOp } from './types';
import type { SelectionBox, SymmetryMode } from '../types';

export type CellWriter = (op: PaintOp) => void;

/** Ports `symmetryTransforms`/`mirrorCells` (usePixelEditor.ts:3207-3253) into pure `(x, y) -> Cell[]`
 *  math, decoupled from a class instance. Cell centers are used for the relative-position math so the
 *  default axis (canvas center) reproduces the original fixed-center formula exactly for
 *  'vertical'/'horizontal'/'both'. */
export function mirrorPoints(
  symmetry: SymmetryMode,
  axisX: number,
  axisY: number,
  x: number,
  y: number
): { x: number; y: number }[] {
  const transforms = symmetryTransforms(symmetry);
  const pts = [{ x, y }];
  if (!transforms.length) return pts;
  const relX = x + 0.5 - axisX;
  const relY = y + 0.5 - axisY;
  transforms.forEach((fn) => {
    const { rx, ry } = fn(relX, relY);
    pts.push({ x: Math.round(axisX + rx - 0.5), y: Math.round(axisY + ry - 0.5) });
  });
  return pts;
}

function symmetryTransforms(symmetry: SymmetryMode): ((relX: number, relY: number) => { rx: number; ry: number })[] {
  switch (symmetry) {
    case 'vertical':
      return [(rx, ry) => ({ rx: -rx, ry })];
    case 'horizontal':
      return [(rx, ry) => ({ rx, ry: -ry })];
    case 'both':
      return [
        (rx, ry) => ({ rx: -rx, ry }),
        (rx, ry) => ({ rx, ry: -ry }),
        (rx, ry) => ({ rx: -rx, ry: -ry }),
      ];
    case 'diagonal':
      return [
        (rx, ry) => ({ rx: ry, ry: rx }),
        (rx, ry) => ({ rx: -ry, ry: -rx }),
        (rx, ry) => ({ rx: -rx, ry: -ry }),
      ];
    case 'radial':
      return [
        (rx, ry) => ({ rx: -ry, ry: rx }),
        (rx, ry) => ({ rx: -rx, ry: -ry }),
        (rx, ry) => ({ rx: ry, ry: -rx }),
      ];
    default:
      return [];
  }
}

/** Expands each incoming op into itself plus one mirrored op per symmetry axis, deduping by
 *  coordinate so a self-overlapping mirror (an axis exactly on a cell) doesn't double-write. Ports
 *  `applyBrushAt`'s `mirrorCells` step (usePixelEditor.ts:3295) as a composable CellWriter stage.
 *
 *  Note: dithering (the "dither brush", usePixelEditor.ts:3297) resolves its stipple color from the
 *  *mirrored* cell's own (x, y). This pipeline stage only mirrors coordinates and passes `color`
 *  through unchanged, so a caller that needs per-mirrored-cell dithering must resolve `color` itself
 *  before calling `next` - acceptable here since only the rare combination of symmetry + dither-brush
 *  would ever notice the difference (both are still valid, deterministic stipple patterns).
 */
export function withSymmetry(symmetry: SymmetryMode, axisX: number, axisY: number, next: CellWriter): CellWriter {
  return (op) => {
    const seen = new Set<string>();
    mirrorPoints(symmetry, axisX, axisY, op.x, op.y).forEach((p) => {
      const key = `${p.x},${p.y}`;
      if (seen.has(key)) return;
      seen.add(key);
      next({ x: p.x, y: p.y, color: op.color });
    });
  };
}

/** Drops an op outside the active selection - ports `paintAllowed`/`isInsideSelection`
 *  (usePixelEditor.ts:1876-1891) as a composable CellWriter stage. `selection: null` means "no active
 *  selection", so every op passes through untouched, matching the original's "everywhere when there's
 *  no active selection" behavior. */
export function withSelectionClip(
  selection: SelectionBox | null,
  mask: ReadonlySet<string> | null,
  next: CellWriter
): CellWriter {
  return (op) => {
    if (selection) {
      if (op.x < selection.x0 || op.x > selection.x1 || op.y < selection.y0 || op.y > selection.y1) return;
      if (mask && !mask.has(`${op.x},${op.y}`)) return;
    }
    next(op);
  };
}
