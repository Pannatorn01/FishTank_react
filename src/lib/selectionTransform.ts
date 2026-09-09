import type { Cell, SelectionBox } from './types';

/** A cell that carries the color to write there - a lifted selection's pixels, in canvas coordinates. */
export interface ColoredCell extends Cell {
  color: string;
}

/** A rectangular region's pixels, captured row-major from its top-left corner. `null` is an empty cell,
 *  or one the selection mask excluded. */
export type RegionPixels = (string | null)[][];

export function boxWidth(box: SelectionBox): number {
  return box.x1 - box.x0 + 1;
}

export function boxHeight(box: SelectionBox): number {
  return box.y1 - box.y0 + 1;
}

/** The selection box a resize drag produces: whichever edges the grabbed handle names follow the
 *  pointer, the others stay put. Re-normalized at the end so dragging a handle past the opposite edge
 *  flips the box rather than inverting it. */
export function resizedBox(origin: SelectionBox, handle: string, c: Cell): SelectionBox {
  let x0 = origin.x0;
  let x1 = origin.x1;
  let y0 = origin.y0;
  let y1 = origin.y1;
  if (handle.includes('w')) x0 = c.x;
  if (handle.includes('e')) x1 = c.x;
  if (handle.includes('n')) y0 = c.y;
  if (handle.includes('s')) y1 = c.y;
  return {
    x0: Math.min(x0, x1),
    x1: Math.max(x0, x1),
    y0: Math.min(y0, y1),
    y1: Math.max(y0, y1),
  };
}

/** Nearest-neighbor scale of a captured region into a new box - deliberately not interpolated: this is
 *  pixel art, and a smoothed resize would invent colors that are not in the palette. */
export function scaledRegionCells(source: RegionPixels, origBox: SelectionBox, newBox: SelectionBox): ColoredCell[] {
  const origW = boxWidth(origBox);
  const origH = boxHeight(origBox);
  const newW = boxWidth(newBox);
  const newH = boxHeight(newBox);
  const out: ColoredCell[] = [];
  for (let y = 0; y < newH; y++) {
    const srcY = Math.min(origH - 1, Math.floor((y / newH) * origH));
    for (let x = 0; x < newW; x++) {
      const srcX = Math.min(origW - 1, Math.floor((x / newW) * origW));
      const color = source[srcY][srcX];
      if (color) out.push({ x: newBox.x0 + x, y: newBox.y0 + y, color });
    }
  }
  return out;
}

/**
 * The one inverse rotation mapping a rotate gesture uses, shared by everything derived from it.
 *
 * Rotation is applied by walking the *destination* cells and asking each one where it came from, not by
 * spinning source pixels forward into new positions: a forward map leaves holes wherever two source
 * cells round to the same destination, an inverse map cannot.
 *
 * Both the rotated pixels and the rotated selection mask have to come out of this same object rather
 * than each deriving the mapping again. That used to be a comment asking the next reader not to let the
 * two drift apart, with two separate copies of the trigonometry underneath it; now there is one copy,
 * and "they cannot disagree" is a property of the code instead of a request.
 */
export function inverseRotation(origin: SelectionBox, angle: number) {
  const w = boxWidth(origin);
  const h = boxHeight(origin);
  const cx = origin.x0 + w / 2;
  const cy = origin.y0 + h / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  return {
    /** Which source cell (canvas coordinates) the destination cell (x, y) draws from. May land outside
     *  `origin` - the corners of a rotated box map to nothing, see `rotatedRegionCells`. */
    sourceOf(x: number, y: number): Cell {
      const relX = x + 0.5 - cx;
      const relY = y + 0.5 - cy;
      return {
        x: Math.floor(relX * cos + relY * sin + cx),
        y: Math.floor(-relX * sin + relY * cos + cy),
      };
    },

    /** The axis-aligned box the rotated region occupies, clamped to a canvas of `width` x `height`.
     *  Built from the region's outer corners (x1 + 1, not x1: the far edge of the last cell, not its
     *  top-left corner), so a 90-degree turn lands exactly on cell boundaries. */
    boundingBox(width: number, height: number): SelectionBox | null {
      const corners: [number, number][] = [
        [origin.x0, origin.y0], [origin.x1 + 1, origin.y0],
        [origin.x0, origin.y1 + 1], [origin.x1 + 1, origin.y1 + 1],
      ];
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      corners.forEach(([px, py]) => {
        const rx = px - cx;
        const ry = py - cy;
        const nx = cx + rx * cos - ry * sin;
        const ny = cy + rx * sin + ry * cos;
        minX = Math.min(minX, nx);
        maxX = Math.max(maxX, nx);
        minY = Math.min(minY, ny);
        maxY = Math.max(maxY, ny);
      });
      const box = {
        x0: Math.max(0, Math.floor(minX)),
        y0: Math.max(0, Math.floor(minY)),
        x1: Math.min(width - 1, Math.ceil(maxX) - 1),
        y1: Math.min(height - 1, Math.ceil(maxY) - 1),
      };
      return box.x1 >= box.x0 && box.y1 >= box.y0 ? box : null;
    },
  };
}

/**
 * The rotated region's pixels. A destination cell whose source lands outside `origin` is **skipped, not
 * clamped** to the nearest edge: the corners of a rotated bounding box are genuinely outside the
 * rotated shape, and there is no pixel there to rotate. Clamping handed those cells the nearest edge
 * pixel instead, which smeared the artwork's border outward into all four corners of the box (the more
 * so the further from a multiple of 90 degrees the angle was) and painted pixels the selection never
 * contained.
 *
 * `box` is the rotated bounding box, or `origin` unchanged when the rotation lands entirely off-canvas.
 */
export function rotatedRegionCells(
  origin: SelectionBox,
  source: RegionPixels,
  angle: number,
  canvasWidth: number,
  canvasHeight: number
): { cells: ColoredCell[]; box: SelectionBox } {
  const rot = inverseRotation(origin, angle);
  const box = rot.boundingBox(canvasWidth, canvasHeight);
  if (!box) return { cells: [], box: origin };

  const cells: ColoredCell[] = [];
  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) {
      const src = rot.sourceOf(x, y);
      if (src.x < origin.x0 || src.x > origin.x1 || src.y < origin.y0 || src.y > origin.y1) continue;
      const color = source[src.y - origin.y0][src.x - origin.x0];
      if (color) cells.push({ x, y, color });
    }
  }
  return { cells, box };
}

/**
 * The selection mask after the same rotation - built through the same `inverseRotation`, so mask,
 * outline and artwork cannot end up describing different shapes. `box` is what `rotatedRegionCells`
 * returned. A plain rectangular selection passes `mask: null`, meaning "every cell of `origin` is
 * selected".
 */
export function rotatedMask(
  origin: SelectionBox,
  mask: ReadonlySet<string> | null,
  angle: number,
  box: SelectionBox
): Set<string> {
  const rot = inverseRotation(origin, angle);
  const out = new Set<string>();
  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) {
      const src = rot.sourceOf(x, y);
      if (src.x < origin.x0 || src.x > origin.x1 || src.y < origin.y0 || src.y > origin.y1) continue;
      if (mask && !mask.has(`${src.x},${src.y}`)) continue;
      out.add(`${x},${y}`);
    }
  }
  return out;
}
