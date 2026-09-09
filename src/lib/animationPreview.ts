import { paintLayers } from './pixelMath';
import type { Layer, Sprite } from './types';

/** The preview panel's own canvas is a fixed 160x160 thumbnail; this is the sprite's on-screen size
 *  inside it, before centering. */
const PREVIEW_CELL_PX_BASE = 96;

/** Above this many cells, the preview stops repainting *during* a stroke and waits for it to end (see
 *  `scheduleRepaint`). A repaint costs a full composite over every layer, at the sprite's own
 *  resolution regardless of the small thumbnail it is drawn into, so on a background-sized canvas it
 *  competes with the drawing it is meant to be previewing. */
const PREVIEW_LIVE_CELL_LIMIT = 128 * 128;

/**
 * The little looping animation of the sprite, in its own canvas beside the editor.
 *
 * It is a viewer, not an editor: it reads the sprite and paints it, and the only thing it knows about
 * the rest of the editor is whether a stroke is currently in progress - which it needs so it can get
 * out of the way on a large canvas. Deliberately keeps its own frame cursor rather than following the
 * frame being edited: the point of the panel is to watch the animation run while working on one frame
 * of it.
 */
export class AnimationPreview {
  /** Which frame the panel is showing. Independent of the editor's own `frameIndex`. */
  frame = 0;

  /** Draws the sprite 3x3 at a third scale, so a tiling sprite's seams are visible. */
  tiled = false;

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private repaintRafId: number | null = null;
  private dirty = false;

  /** Scratch off-screen canvas reused across composites rather than reallocated per paint. */
  private bitmap: HTMLCanvasElement | null = null;

  private readonly sprite: () => Sprite;
  private readonly isPainting: () => boolean;

  constructor(sprite: () => Sprite, isPainting: () => boolean) {
    this.sprite = sprite;
    this.isPainting = isPainting;
  }

  attach(el: HTMLCanvasElement | null): void {
    const isNew = el !== null && el !== this.canvas;
    this.canvas = el;
    this.ctx = el ? el.getContext('2d') : null;
    // A freshly attached canvas is blank until something paints it, and for a single-frame sprite no
    // timer ever will - paint it once here so the panel isn't empty until the first edit.
    if (isNew) this.paint();
  }

  destroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.repaintRafId !== null) {
      cancelAnimationFrame(this.repaintRafId);
      this.repaintRafId = null;
    }
  }

  /** Restarts the animation timer for the sprite's current frame count and speed. */
  restart(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // paint(), not tick(): restarting the timer (changing speed, adding a frame, loading a sprite)
    // shouldn't itself advance the animation by one frame.
    this.paint();
    const sprite = this.sprite();
    if (sprite.frames.length > 1) {
      this.timer = setInterval(() => this.tick(), sprite.frameMs);
    }
  }

  /** Starts or stops the timer so it always matches the current frame count. Checked on every engine
   *  refresh rather than from each of add/duplicate/delete/move frame: those all reach refresh, and
   *  none of them used to restart the timer, so adding a 2nd frame to a single-frame sprite left the
   *  preview frozen on frame 1 forever - it animated only if some *other* action (a speed change, a
   *  reload) happened to restart the timer afterwards. Comparing against the timer's own existence
   *  makes this idempotent, so the common no-op refresh costs one comparison. */
  syncTimer(): void {
    if (this.sprite().frames.length > 1 === (this.timer !== null)) return;
    this.restart();
  }

  /** Advances to the next frame, then paints it - the animation timer's tick. Painting the frame that
   *  is already showing is `paint`'s job, not this one's: they used to be a single method, which is why
   *  a single-frame sprite (no timer, so nothing ever called it) showed a preview that never updated no
   *  matter how much was drawn. */
  private tick(): void {
    if (!this.canvas || !this.ctx) return;
    this.frame = (this.frame + 1) % this.sprite().frames.length;
    this.paint();
  }

  /**
   * Repaints with whatever frame is currently showing, at most once per animation frame. Called on
   * every content change, which during a fast stroke means many times between two browser paints -
   * hence the dirty flag instead of painting inline.
   *
   * Past PREVIEW_LIVE_CELL_LIMIT the repaint is held back until the stroke finishes; `flush` re-arms
   * it, so the deferred repaint still lands the moment the gesture ends.
   */
  scheduleRepaint(): void {
    if (!this.canvas || !this.ctx) return;
    this.dirty = true;
    if (this.repaintRafId !== null) return;
    this.repaintRafId = requestAnimationFrame(() => {
      this.repaintRafId = null;
      if (!this.dirty) return;
      const { width, height } = this.sprite();
      if (this.isPainting() && width * height > PREVIEW_LIVE_CELL_LIMIT) return;
      this.dirty = false;
      this.paint();
    });
  }

  /** Re-arms a repaint that `scheduleRepaint` skipped because a stroke was in progress - a no-op when
   *  nothing has actually changed, so ending a gesture that painted nothing (a stray click, a
   *  cancelled shape) doesn't cost a full recomposite on a large sprite. */
  flush(): void {
    if (this.dirty) this.scheduleRepaint();
  }

  /** Composites layers at their native, unscaled 1px-per-cell resolution onto the reused off-screen
   *  canvas. The panel needs this indirection because its own canvas is a different, unrelated size
   *  from the sprite, so it has to composite once and then blit scaled. (The main editing canvas does
   *  not: it is native-resolution itself, and paints directly.) */
  private composite(layers: Layer[], width: number, height: number): HTMLCanvasElement {
    if (!this.bitmap) this.bitmap = document.createElement('canvas');
    const bmp = this.bitmap;
    if (bmp.width !== width || bmp.height !== height) {
      bmp.width = width;
      bmp.height = height;
    }
    const bctx = bmp.getContext('2d')!;
    bctx.clearRect(0, 0, width, height);
    paintLayers(bctx, layers, width, height, 1);
    return bmp;
  }

  paint(): void {
    if (!this.canvas || !this.ctx) return;
    const { frames, width, height } = this.sprite();
    // Clamped rather than assumed in range: frames can shrink under the preview (deleting a frame, or
    // loading a shorter sprite) between one paint and the next.
    if (this.frame >= frames.length) this.frame = 0;
    const cellPx = PREVIEW_CELL_PX_BASE / Math.max(width, height);
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.imageSmoothingEnabled = false;
    const bmp = this.composite(frames[this.frame], width, height);
    if (this.tiled) {
      const tileCellPx = cellPx / 3;
      const tileW = width * tileCellPx;
      const tileH = height * tileCellPx;
      for (let ty = -1; ty <= 1; ty++) {
        for (let tx = -1; tx <= 1; tx++) {
          const dx = this.canvas.width / 2 + tx * tileW - tileW / 2;
          const dy = this.canvas.height / 2 + ty * tileH - tileH / 2;
          ctx.drawImage(bmp, 0, 0, width, height, dx, dy, tileW, tileH);
        }
      }
      return;
    }
    const dx = (this.canvas.width - width * cellPx) / 2;
    const dy = (this.canvas.height - height * cellPx) / 2;
    ctx.drawImage(bmp, 0, 0, width, height, dx, dy, width * cellPx, height * cellPx);
  }
}
