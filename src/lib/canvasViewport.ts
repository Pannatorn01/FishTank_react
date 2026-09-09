/** One sprite cell at 100% zoom, in CSS pixels. Every on-screen size in here is `cells * BASE_CELL_PX
 *  * scale`. */
export const BASE_CELL_PX = 16;

/** Quick-pick presets for the zoom field's dropdown - purely UI shortcuts, not the internal scale. */
export const ZOOM_LEVELS = [0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5, 8];
export const MIN_ZOOM_SCALE = 0.05;
export const MAX_ZOOM_SCALE = 32;

/** Caps a zoomed-in canvas's on-screen (CSS) size regardless of the sprite's own dimensions - see
 *  `maxScale`. */
const MAX_RENDERED_CANVAS_PX = 8000;

/** Multiplicative step for the zoom +/- buttons and the base of the scroll-wheel zoom curve. */
export const ZOOM_BUTTON_STEP = 1.2;

/** How much of the canvas must stay inside .pixel-canvas-wrap after any pan (screen px, per axis). */
const PAN_EDGE_MARGIN_PX = 56;

/** Wrap (viewport) and canvas geometry in the wrap's padding-box coordinates. */
export interface ViewMetrics {
  wrapW: number;
  wrapH: number;
  canvasW: number;
  canvasH: number;
  /** Where the canvas's top-left corner sits with pan at 0 - measured, not derived from the CSS. */
  restX: number;
  restY: number;
}

/**
 * How much of the sprite is on screen, and where: the zoom scale, the pan offset, and the canvas
 * element's own CSS size. Nothing here knows what a pixel *is* - it never reads a cell, a layer or a
 * frame, only how many cells wide and tall the sprite currently is.
 *
 * It owns the DOM side of the view because that is where the view actually lives: the canvas bitmap
 * stays at native resolution (one bitmap pixel per cell) and CSS does the zooming, so "zoom" is a
 * style write, not a repaint. Pan is a transform on the canvas's wrapper, written straight to the
 * element rather than through React - a hand-drag fires many times between two renders and the
 * transform is the only thing it changes.
 */
export class CanvasViewport {
  /** Continuous zoom factor (1 = 100%) - not locked to ZOOM_LEVELS' fixed steps, which remain only as
   *  quick-pick presets in the status bar. Clamped to [minScale(), maxScale()] by `setScale`; also set
   *  directly (via `resetScaleFor`) wherever the sprite's own width/height changes - resize, trim, or
   *  loading/creating/importing a sprite - since a zoom level picked for one sprite's dimensions can
   *  otherwise overflow the wrap for a differently-sized one it carries over to, with no visible sign
   *  beyond a stray scrollbar (place-items:center hides the clipped edges). */
  scale = 1;

  /** The view offset (screen px), applied as a transform on .pixel-canvas-inner on top of the CSS
   *  centering .pixel-canvas-wrap gives it. This is the *only* way the view moves: the wrap used to be
   *  overflow:auto and pan was split between native scrollLeft/scrollTop and this transform, which meant
   *  a scrollbar appearing or disappearing mid-stroke resized the wrap's content box and visibly jumped
   *  the canvas out from under the cursor. The wrap is overflow:hidden now (see index.css) and every pan
   *  - hand-drag, wheel, scrollbar, zoom anchoring - goes through `panBy`/`clampPan` instead, so nothing
   *  about the view depends on layout that can change while drawing. Reset to 0 wherever the view should
   *  snap back to a plain default (zoomToFit, a resized canvas, a different sprite) rather than carry
   *  over a stale offset from whatever was on screen before. */
  panX = 0;
  panY = 0;

  /** The pan currently written into .pixel-canvas-inner's transform, which is what the canvas's measured
   *  rect reflects. Distinct from panX/panY, which are already the *next* value by the time `clampPan`
   *  measures: subtracting the new pan from a rect still showing the old one made `metrics()`'s `restX`
   *  drift by exactly one pan step, so a fast drag stopped short of the real clamp. Only
   *  `applyPanToDom` writes these, and it is the only thing that writes the transform. */
  private appliedPanX = 0;
  private appliedPanY = 0;

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  /** The sprite's size in cells. A callback rather than a stored value: the sprite can be resized or
   *  replaced underneath the viewport, and every read here wants the current one. */
  private readonly spriteSize: () => { width: number; height: number };

  /** Called when something a React render would show has changed. Pan writes that only move the
   *  transform deliberately do not call it. */
  private readonly notify: () => void;

  constructor(spriteSize: () => { width: number; height: number }, notify: () => void) {
    this.spriteSize = spriteSize;
    this.notify = notify;
  }

  attach(canvas: HTMLCanvasElement | null, ctx: CanvasRenderingContext2D | null): void {
    this.canvas = canvas;
    this.ctx = ctx;
  }

  /** The wrap is the canvas's grandparent: canvas -> .pixel-canvas-inner (the panned element) ->
   *  .pixel-canvas-wrap (the viewport). Read from the DOM rather than passed in, so a component never
   *  has to keep a second ref in sync with this one. */
  private wrapEl(): HTMLElement | null {
    return (this.canvas?.parentElement?.parentElement as HTMLElement | null) ?? null;
  }

  private innerEl(): HTMLElement | null {
    return (this.canvas?.parentElement as HTMLElement | null) ?? null;
  }

  cellPx(): number {
    return BASE_CELL_PX * this.scale;
  }

  /** A canvas's max zoom scales down as its own dimensions grow, so the on-screen size (width x cellPx)
   *  never blows past a sane pixel count regardless of how large the sprite is - a tiny sprite can zoom
   *  in much further (up to MAX_ZOOM_SCALE) than a background-sized one. Never below 4x even for the
   *  largest allowed canvas, so "zoom in" is never fully dead on a huge one. */
  maxScale(): number {
    const { width, height } = this.spriteSize();
    const maxDim = Math.max(width, height);
    return Math.max(4, Math.min(MAX_ZOOM_SCALE, MAX_RENDERED_CANVAS_PX / (maxDim * BASE_CELL_PX)));
  }

  minScale(): number {
    return MIN_ZOOM_SCALE;
  }

  label(): string {
    return `${Math.round(this.scale * 100)}%`;
  }

  /** The zoom a freshly loaded or resized sprite opens at - a large one starts pulled back a little so
   *  the whole thing is in view, a small one at 1:1. */
  defaultScaleForSize(maxDim: number): number {
    return Math.min(this.maxScale(), maxDim >= 32 ? 0.75 : 1);
  }

  /** Sets the scale directly, without the anchor/clamping dance - for the paths that are replacing the
   *  sprite anyway (load, resize) and follow it with a pan reset. */
  resetScaleFor(maxDim: number): void {
    this.scale = this.defaultScaleForSize(maxDim);
  }

  /**
   * Resizes the canvas bitmap to the sprite's native size and updates its CSS size.
   *
   * The bitmap is native resolution - exactly 1 pixel per cell (e.g. 1400x900, not 1400x900 *cellPx*) -
   * with CSS doing the zoom (plus .pixelated's image-rendering: pixelated for a crisp, un-blurred
   * scale-up). Zooming or scrolling a huge canvas is then a free GPU compositor operation, not a JS
   * re-render: the old approach (bitmap sized to width*cellPx) meant a background-sized canvas at
   * typical zoom was allocating tens of millions of physical pixels, all of which had to be re-cleared
   * and re-blitted on every single pointer move while painting - that's what made painting on a large
   * canvas visibly lag. Grid lines, symmetry guides, the selection-draft marquee and the curve control
   * handle all moved to a DOM overlay (PixelSelectionOverlay.tsx) as a consequence: at 1px-per-cell
   * there's no room to draw a hairline *between* cells, or a fixed-size handle glyph, on the canvas.
   *
   * The bitmap assignment is skipped when the dimensions haven't changed: assigning canvas.width/height
   * always resets the bitmap to transparent whether or not the value differs, so doing it on every zoom
   * tick would force a full repaint for a change that never touches a pixel of content, only the scale.
   */
  syncCanvasSize(): void {
    if (!this.canvas) return;
    const { width, height } = this.spriteSize();
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      // Resizing width/height resets all context state, including this - must be re-applied every
      // time, not just once at creation.
      if (this.ctx) this.ctx.imageSmoothingEnabled = false;
    }
    this.syncCssSize();
  }

  /** Just the on-screen (CSS) size - the half of `syncCanvasSize` a pure zoom change actually needs,
   *  without also touching (and clearing) the canvas bitmap. */
  syncCssSize(): void {
    if (!this.canvas) return;
    const { width, height } = this.spriteSize();
    const cellPx = this.cellPx();
    this.canvas.style.width = `${width * cellPx}px`;
    this.canvas.style.height = `${height * cellPx}px`;
    this.canvas.style.backgroundSize = `${cellPx * 2}px ${cellPx * 2}px`;
  }

  /** Zooms to `scale`, keeping whatever is under `anchor` (a client point, e.g. the mouse) in place. */
  setScale(scale: number, anchor?: { clientX: number; clientY: number }): void {
    const clamped = Math.min(this.maxScale(), Math.max(this.minScale(), scale));
    if (clamped === this.scale) return;
    const rectBefore = anchor && this.canvas ? this.canvas.getBoundingClientRect() : null;
    this.scale = clamped;
    this.syncCssSize();
    if (rectBefore && anchor && this.canvas && rectBefore.width > 0 && rectBefore.height > 0) {
      // Where the cursor sits as a fraction across the canvas's old on-screen box - a fraction, not an
      // absolute cell/px position, so it's meaningful before and after the size actually changes.
      const fracX = (anchor.clientX - rectBefore.left) / rectBefore.width;
      const fracY = (anchor.clientY - rectBefore.top) / rectBefore.height;
      const rectAfter = this.canvas.getBoundingClientRect();
      const naturalX = rectAfter.left + fracX * rectAfter.width;
      const naturalY = rectAfter.top + fracY * rectAfter.height;
      // That same fraction now naturally renders at (naturalX, naturalY) - wherever CSS centering and
      // the previous panX/panY happened to land it - which has drifted from the cursor by exactly
      // (naturalX - anchor.clientX, naturalY - anchor.clientY); absorbing that closes the gap.
      this.absorbPanCorrection(naturalX - anchor.clientX, naturalY - anchor.clientY);
    }
    this.notify();
  }

  /**
   * Applies a (dx, dy) screen-px correction - "content needs to shift left/up by this much to bring the
   * zoom anchor back under the cursor" - straight to panX/panY, then clamps.
   *
   * This used to be far more involved: with the wrap as an overflow:auto scroll container it had to
   * decide, per axis, whether to spend the correction on native scrollLeft/scrollTop or on the
   * transform, because CSS grid centering pins scroll at 0 whenever the canvas fits, while a transform
   * and native scroll both inflate a scroll container's overflow area independently and the browser
   * reconciles neither - two separate feedback loops that each produced real anchor drift. Making the
   * wrap overflow:hidden and moving the view entirely into the transform deletes both problems rather
   * than balancing them.
   */
  private absorbPanCorrection(dx: number, dy: number): void {
    this.panX -= dx;
    this.panY -= dy;
    this.clampPan();
    this.applyPanToDom();
  }

  /**
   * Geometry the pan clamp and the overlay scrollbars both work from, in the wrap's padding-box
   * coordinates. `restX`/`restY` are where the canvas's top-left corner sits with pan at 0 - measured
   * (current rect minus the pan currently in the transform), not derived from the CSS.
   *
   * Measured because deriving it is wrong in exactly the case that matters: .pixel-canvas-wrap centers
   * with grid `place-items: center`, which suggests an oversized canvas rests at (wrapW - canvasW) / 2,
   * overflowing equally on both sides. It doesn't - a grid item larger than its area resolves to the
   * content box's start edge instead, so its resting offset is 0, not a large negative number. Assuming
   * the centered value made the pan clamp wrong by exactly that difference in *opposite* directions on
   * the two edges: one direction stopped while the canvas still filled the whole viewport, the other
   * let it be dragged entirely off screen. Measuring is also robust to any future change in how the
   * wrap lays its content out, which deriving would silently break again.
   *
   * Null before the canvas is attached.
   */
  metrics(): ViewMetrics | null {
    const wrap = this.wrapEl();
    if (!wrap || !this.canvas) return null;
    const wrapRect = wrap.getBoundingClientRect();
    const canvasRect = this.canvas.getBoundingClientRect();
    return {
      wrapW: wrap.clientWidth,
      wrapH: wrap.clientHeight,
      canvasW: canvasRect.width,
      canvasH: canvasRect.height,
      // clientLeft/clientTop are the border widths - subtracting them puts these in the same
      // padding-box coordinates as clientWidth/clientHeight above, which is also what
      // `position: absolute` uses for the overlay scrollbars.
      restX: canvasRect.left - wrapRect.left - wrap.clientLeft - this.appliedPanX,
      restY: canvasRect.top - wrapRect.top - wrap.clientTop - this.appliedPanY,
    };
  }

  /** Keeps at least PAN_EDGE_MARGIN_PX of canvas inside the wrap on each axis (or the whole canvas,
   *  when it's smaller than that margin). Written in terms of the measured resting offset from
   *  `metrics` - see there for why that isn't computed from the wrap's centering. */
  private clampPan(): void {
    const m = this.metrics();
    if (!m) return;
    const axis = (pan: number, wrap: number, size: number, rest: number): number => {
      if (wrap <= 0) return pan;
      const margin = Math.min(PAN_EDGE_MARGIN_PX, size);
      // Leading edge no further right than wrapW - margin; trailing edge no further left than margin.
      return Math.min(wrap - margin - rest, Math.max(margin - size - rest, pan));
    };
    this.panX = axis(this.panX, m.wrapW, m.canvasW, m.restX);
    this.panY = axis(this.panY, m.wrapH, m.canvasH, m.restY);
  }

  /** Writes panX/panY to .pixel-canvas-inner synchronously instead of waiting for React's next render.
   *  A hand-drag or wheel-pan fires many times between two renders, and the transform is the only thing
   *  those change - going through React for each one would add a render per pointermove for no reason
   *  (PixelCanvas.tsx renders the same value from state on its own next render, so the two agree). */
  private applyPanToDom(): void {
    const inner = this.innerEl();
    if (!inner) return;
    inner.style.transform = this.panX || this.panY ? `translate(${this.panX}px, ${this.panY}px)` : '';
    this.appliedPanX = this.panX;
    this.appliedPanY = this.panY;
  }

  /** Snaps the view back to its default position. Every "the view should start fresh" site goes through
   *  this rather than assigning panX/panY directly, so the transform (and appliedPanX/Y with it) can
   *  never be left describing a pan that's already been zeroed. */
  clearPan(): void {
    this.panX = 0;
    this.panY = 0;
    this.applyPanToDom();
  }

  /** Moves the view by (dx, dy) screen px - the single entry point for hand-drag, wheel-pan and the
   *  overlay scrollbars. `notify` is opt-in because the two drag paths repaint the transform themselves
   *  and have nothing else on screen to update. */
  panBy(dx: number, dy: number, notify = false): void {
    if (!dx && !dy) return;
    this.panX += dx;
    this.panY += dy;
    this.clampPan();
    this.applyPanToDom();
    if (notify) this.notify();
  }

  /** Recentres the view without changing zoom - the escape hatch when the canvas has been panned
   *  somewhere unhelpful. */
  resetPan(): void {
    this.clearPan();
    this.notify();
  }

  /** Multiplicative zoom-button step, anchored at the wrap's own visible center so the view stays
   *  centered on whatever's already on screen instead of jumping toward the origin. */
  private zoomAtViewportCenter(scale: number): void {
    const wrap = this.wrapEl();
    if (!wrap) {
      this.setScale(scale);
      return;
    }
    const rect = wrap.getBoundingClientRect();
    this.setScale(scale, { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 });
  }

  zoomIn(): void {
    this.zoomAtViewportCenter(this.scale * ZOOM_BUTTON_STEP);
  }

  zoomOut(): void {
    this.zoomAtViewportCenter(this.scale / ZOOM_BUTTON_STEP);
  }

  /** Sets a continuous zoom scale that shows the whole canvas inside the wrap without scrolling -
   *  unlike ZOOM_LEVELS' smallest preset step, which still isn't nearly small enough for a large canvas
   *  (e.g. a 1400x900 background). Reads the wrap's current size straight from the DOM rather than
   *  needing a ResizeObserver plumbed in from the component: this is a one-shot fit-right-now action,
   *  not an ambient always-fit mode, so there's nothing to keep in sync between clicks. */
  zoomToFit(): void {
    const wrap = this.wrapEl();
    if (!wrap) return;
    const cs = getComputedStyle(wrap);
    const availW = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const availH = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (availW <= 0 || availH <= 0) return;
    const { width, height } = this.spriteSize();
    const scale = Math.min(availW / (width * BASE_CELL_PX), availH / (height * BASE_CELL_PX));
    this.clearPan();
    this.setScale(scale);
  }
}
