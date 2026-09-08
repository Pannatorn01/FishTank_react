import type { SelectionBox } from '../types';

/** Accumulates cells/rects touched during a gesture into one canvas-clamped bounding box - ports the
 *  engine's old `cellsDirtyRects` into a reusable accumulator every tool shares, instead of each tool
 *  computing its own bounding-box math inline. Matches the original's behavior of a single merged rect
 *  (not a list), since that's what every current call site actually needs - see `redrawRegions`' doc
 *  comment in usePixelEditor.ts for why bounding the repaint to just the changed area (not the whole
 *  canvas) is the whole point. */
export class DirtyRectTracker {
  private x0 = Infinity;
  private y0 = Infinity;
  private x1 = -Infinity;
  private y1 = -Infinity;

  addCell(x: number, y: number, pad = 0): void {
    if (x - pad < this.x0) this.x0 = x - pad;
    if (x + pad > this.x1) this.x1 = x + pad;
    if (y - pad < this.y0) this.y0 = y - pad;
    if (y + pad > this.y1) this.y1 = y + pad;
  }

  addCells(cells: { x: number; y: number }[], pad = 0): void {
    cells.forEach((c) => this.addCell(c.x, c.y, pad));
  }

  addRect(r: SelectionBox): void {
    if (r.x0 < this.x0) this.x0 = r.x0;
    if (r.x1 > this.x1) this.x1 = r.x1;
    if (r.y0 < this.y0) this.y0 = r.y0;
    if (r.y1 > this.y1) this.y1 = r.y1;
  }

  isEmpty(): boolean {
    return this.x1 < this.x0 || this.y1 < this.y0;
  }

  /** Returns the merged, canvas-clamped rect, or an empty array if nothing was ever added (or
   *  everything added fell entirely outside the canvas). */
  toRects(width: number, height: number): SelectionBox[] {
    if (this.isEmpty()) return [];
    const x0 = Math.max(0, this.x0);
    const y0 = Math.max(0, this.y0);
    const x1 = Math.min(width - 1, this.x1);
    const y1 = Math.min(height - 1, this.y1);
    if (x1 < x0 || y1 < y0) return [];
    return [{ x0, y0, x1, y1 }];
  }
}
