import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  bresenhamLine,
  flipFrameH,
  flipFrameV,
  hexToRgb,
  inEllipseLocal,
  layersDiffRegion,
  normalizeBox,
  paintLayers,
  rgbToHex,
  rotateFrame,
  shiftBox,
} from '@/lib/pixelMath';
import { t } from '@/lib/i18n';
import * as storage from '@/lib/storage';
import type { CanvasBackground, Cell, Frame, Layer, SelectionBox, Sprite, SpriteType, SymmetryMode, ToolName } from '@/lib/types';

export const DEFAULT_PALETTE_COLORS = [
  '#1a1a1a', '#ffffff', '#e74c3c', '#ff7043', '#f5c518', '#8bc34a', '#1e88e5', '#5e35b1',
];

const FRAME_LIMIT = 5;
const LAYER_LIMIT = storage.LAYER_LIMIT;
const BASE_CELL_PX = 16;
/** Quick-pick presets for the zoom field's dropdown - purely UI shortcuts now, not the internal
 *  representation of zoom (see zoomScale/setZoom): zoom is a continuous float that can land anywhere,
 *  including values none of these name. */
export const ZOOM_LEVELS = [0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5, 8];
export const MIN_ZOOM_SCALE = 0.05;
export const MAX_ZOOM_SCALE = 32;
/** Caps a zoomed-in canvas's on-screen (CSS) size, regardless of the sprite's own dimensions - see
 *  maxZoomScale. Large enough to let a small sprite zoom in a lot, small enough that scrolling a
 *  zoomed-in huge canvas doesn't hand the browser an absurdly large layout box. */
const MAX_RENDERED_CANVAS_PX = 8000;
/** Multiplicative step for the zoom +/- buttons and the base of the scroll-wheel zoom curve (see
 *  PixelCanvas.tsx) - a ratio, not a fixed amount, so a step feels proportionate at any zoom level
 *  (50%→60% and 400%→480% are both "one click") instead of mattering a lot at low zoom and nothing at
 *  high zoom the way a fixed +0.1 would. */
export const ZOOM_BUTTON_STEP = 1.2;
const PREVIEW_CELL_PX_BASE = 96;
const UNDO_LIMIT = 50;
export const MAX_BRUSH_SIZE = 20;
/** Tools that share the brush-size stepper (see CanvasStatusBar's `showBrushOptions` / PixelCanvas's
 *  brush-footprint preview) - each remembers its own size (see brushSizes/brushSizeToolKey) since a
 *  size picked for one shouldn't silently carry over to another. Line/rect/ellipse read the same
 *  `brushSize` to thicken their outline (see computeShapeCells), and curve thickens its own path the
 *  same way (see quadraticBezierCells/thickenPath) - gradient and the selection tools have no
 *  comparable "stroke width" concept, so they're deliberately left out. */
export const BRUSH_SIZE_TOOLS = new Set<ToolName>(['pen', 'eraser', 'spray', 'line', 'rect', 'ellipse', 'curve']);
const SPRAY_INTERVAL_MS = 55;
const TOOL_KEYS: Record<string, ToolName> = {
  b: 'pen', e: 'eraser', f: 'fill', i: 'eyedropper', l: 'line', u: 'curve', r: 'rect', c: 'ellipse',
  a: 'spray', k: 'gradient', m: 'select', v: 'move',
};
/** Tools where a right-click has an alternate meaning (erase, or reversed gradient) instead of opening the browser context menu. */
const ERASABLE_TOOLS = new Set<ToolName>(['pen', 'eraser', 'line', 'curve', 'rect', 'ellipse', 'fill', 'spray', 'gradient']);
/** Tools where holding Alt temporarily samples a color instead of the tool's normal action. */
const ALT_PICK_TOOLS = new Set<ToolName>(['pen', 'eraser', 'line', 'curve', 'rect', 'ellipse', 'fill', 'spray', 'gradient']);
/** Tools that create/edit a selection - rectangular marquee and freeform lasso are two ways to make
 *  the same kind of selection (see selectionMask/lassoPoints), so they share all of its chrome/rules. */
const SELECTION_TOOLS = new Set<ToolName>(['select', 'lasso']);
/** SELECTION_TOOLS plus 'move' - the selection border (marching ants) and its move-cursor hint stay
 *  visible/active while the Move tool is selected too, not just while actively editing the selection
 *  shape, so switching to Move to drag a selection doesn't make it look like nothing is selected. */
const SELECTION_AWARE_TOOLS = new Set<ToolName>(['select', 'lasso', 'move']);

export type HandleName = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e';
/** Size (px) of a resize handle's square - exported for PixelSelectionOverlay.tsx, which draws the
 *  settled selection's handles as DOM elements rather than on this <canvas> (see selectionOverlayBox). */
export const HANDLE_SIZE = 6;
/** Cursor per resize handle - exported for PixelSelectionOverlay.tsx, which sets it on the DOM
 *  handle elements directly (CSS) rather than via canvas pointermove hit-testing. */
export const HANDLE_CURSORS: Record<HandleName, string> = {
  nw: 'nwse-resize', se: 'nwse-resize',
  ne: 'nesw-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize',
  w: 'ew-resize', e: 'ew-resize',
};
const ROTATE_HANDLE_OFFSET = 24;
/** Radius of the rotate handle's drawn circle - exported for PixelSelectionOverlay.tsx, which draws
 *  the handle as a DOM element rather than on this <canvas> (see rotateHandlePos/selectionRotateHandle). */
export const ROTATE_HANDLE_RADIUS = 7;
const ROTATE_HIT_RADIUS = 11;

function blankSprite(): Sprite {
  const size = storage.DEFAULT_GRID_SIZE;
  return {
    id: null,
    name: '',
    type: 'fish',
    width: size,
    height: size,
    frames: [[storage.makeLayer(storage.emptyFrame(size, size))]],
    frameMs: storage.DEFAULT_FRAME_MS,
  };
}

function cloneSprite(sprite: Sprite): Sprite {
  return structuredClone(sprite);
}

interface MoveBufferCell extends Cell {
  color: string;
}

interface Snapshot {
  frames: Layer[][];
  width: number;
  height: number;
  frameIndex: number;
  activeLayerIndex: number;
  frameMs: number;
}

class PixelEditorEngine {
  canvas: HTMLCanvasElement | null = null;
  ctx: CanvasRenderingContext2D | null = null;
  previewCanvas: HTMLCanvasElement | null = null;
  previewCtx: CanvasRenderingContext2D | null = null;
  /** Scratch off-screen canvas for compositeToBitmap - reused (resized in place) across calls rather
   *  than allocated fresh each time, since drawGrid() calls it on every pointer move while painting. */
  private spriteBitmap: HTMLCanvasElement | null = null;
  /** Snapshot of everything except the in-flight move/resize/rotate preview, taken once when that
   *  gesture starts (see cacheGestureBaseBitmap) - a separate canvas from spriteBitmap above, which
   *  tickPreview() also writes to on its own timer and would otherwise race with a gesture in progress.
   *  drawGrid() blits this with one drawImage() on every pointer move during the gesture instead of
   *  re-running paintLayers() over every layer - the base scene hasn't changed (only the dragged
   *  region's on-screen position has), so redoing that full paint on every single move was the actual
   *  cost that made dragging a selection on a large canvas (e.g. a 1400×900 background) visibly lag. */
  private gestureBaseBitmap: HTMLCanvasElement | null = null;

  sprites: Sprite[] = [];
  current: Sprite = blankSprite();
  frameIndex = 0;
  activeLayerIndex = 0;
  tool: ToolName = 'pen';
  color = DEFAULT_PALETTE_COLORS[3];
  paletteColors: string[] = [];
  savedColors: string[] = [];
  painting = false;
  lastPaintCell: Cell | null = null;
  shapeStart: Cell | null = null;
  shapePreviewCells: Cell[] | null = null;
  shapeFilled = false;
  selection: SelectionBox | null = null;
  selectStart: Cell | null = null;
  selectionDraft: SelectionBox | null = null;
  /** Freeform outline for a lasso-made selection (closed polygon, canvas cell coords) - null for a
   *  plain rectangular marquee selection, where the whole `selection` box counts as selected. Kept in
   *  sync with `selection`/`selectionMask` by every op that moves/shifts a selection. */
  lassoPoints: Cell[] | null = null;
  /** In-progress freeform path while dragging out a new lasso selection - promoted to `lassoPoints`
   *  (and used to derive selectionMask) on release; null the rest of the time. */
  lassoDraftPoints: Cell[] | null = null;
  /** Which cells inside `selection`'s bounding box are actually selected - null means "all of them"
   *  (a rectangular marquee selection). Sparse (`"x,y"` keys) rather than a full width×height grid
   *  since a selection is typically a small fraction of a large canvas. Centralizes freeform-selection
   *  awareness in captureSelectionPixels/clearFrameRegion/startMoveGesture/nudgeSelection, so move,
   *  resize, rotate, and copy all naturally respect a lasso's actual shape instead of its bounding box. */
  selectionMask: Set<string> | null = null;
  resizeHandle: HandleName | null = null;
  resizeOrigin: SelectionBox | null = null;
  resizeSource: (string | null)[][] | null = null;
  resizePreview: MoveBufferCell[] | null = null;
  rotateOrigin: SelectionBox | null = null;
  rotateSource: (string | null)[][] | null = null;
  rotateStartAngle = 0;
  rotateAngle = 0;
  rotatePreview: MoveBufferCell[] | null = null;
  moveBuffer: { cells: MoveBufferCell[] } | null = null;
  moveStartCell: Cell | null = null;
  moveDelta = { dx: 0, dy: 0 };
  clipboard: { w: number; h: number; rows: (string | null)[][] } | null = null;
  symmetry: SymmetryMode = 'none';
  /** Per-tool brush size (pen/eraser/spray each remember their own - see brushSizeToolKey/BRUSH_SIZE_TOOLS),
   *  persisted so a size picked in one session survives a reload. */
  private brushSizes: Record<string, number> = {};
  /** Last-known pointer position over the canvas, in on-screen px relative to .pixel-canvas-inner -
   *  drives the brush-footprint preview outline (see brushPreviewRect) via a DOM overlay rather than a
   *  cursor image, so the outline isn't capped by the browser's max custom-cursor size at large brush
   *  sizes/zoom. Cleared on pointer leave/up so the preview disappears when the cursor isn't over the canvas. */
  hoverPointerPx: { px: number; py: number } | null = null;
  /** Set for the duration of a right-click gesture: paints/fills/erases with the eraser instead of the active color. */
  eraseOverride = false;
  /** Snapshot of the active layer taken at freehand-stroke start, so Pixel Perfect can restore a trimmed corner pixel. */
  strokeSnapshot: Frame | null = null;
  strokePoints: Cell[] = [];
  sprayTimer: ReturnType<typeof setInterval> | null = null;
  sprayPointerCell: Cell | null = null;
  /** Curve tool: null = idle, 'drag-end' = dragging the initial line, 'bend' = adjusting the control-point handle. */
  curvePhase: 'drag-end' | 'bend' | null = null;
  curveStart: Cell | null = null;
  curveEnd: Cell | null = null;
  curveControl: Cell | null = null;
  curveDraggingControl = false;
  gradientColor = '#ffffff';
  gradientStart: Cell | null = null;
  gradientEnd: Cell | null = null;
  gradientPreview: MoveBufferCell[] | null = null;
  /** Continuous zoom factor (1 = 100%) - not locked to ZOOM_LEVELS's fixed steps, which remain only as
   *  quick-pick presets in the status bar. Clamped to [minZoomScale(), maxZoomScale()] by setZoom,
   *  the only place that ever changes it. */
  zoomScale = 1;
  /** Manual correction (screen px) applied as a transform on .pixel-canvas-inner, on top of whatever
   *  CSS centering/native scroll already puts it at - see setZoom's doc comment for why cursor-anchored
   *  zoom needs this instead of just adjusting the wrap's scrollLeft/scrollTop. Reset to 0 wherever the
   *  view should snap back to a plain default (zoomToFit, a resized canvas, a different sprite) rather
   *  than carry over a stale correction from whatever was on screen before. */
  panX = 0;
  panY = 0;
  /** True for the duration of a middle-mouse-button drag, panning the view via the wrap's native scroll
   *  regardless of the active tool - see onPointerDown/Move/Up. Deliberately doesn't reuse `painting`
   *  (and isn't itself gated by it): this needs to work mid-stroke, mid-shape-drag, etc. without
   *  disturbing whatever the primary button is doing, the same way it works in Paint/Photoshop/Pixilart. */
  private middlePanActive = false;
  /** Last pointer position (client px) seen during a middle-pan drag, to derive each move's delta -
   *  null the rest of the time. */
  private middlePanLast: { x: number; y: number } | null = null;
  showGrid = true;
  canvasBackground: CanvasBackground = 'checker-dark';
  onionSkin = false;
  transformAllFrames = false;
  undoStack: Snapshot[] = [];
  redoStack: Snapshot[] = [];
  previewFrame = 0;
  dirty = false;
  active = true;
  /** Bumped only when a *different* sprite becomes current (new/load), never on save-in-place. */
  loadToken = 0;

  private previewTimer: ReturnType<typeof setInterval> | null = null;
  private reactNotify: () => void = () => {};
  private notifyRafId: number | null = null;
  private windowListeners: Array<() => void> = [];

  init(notify: () => void): void {
    // rAF-coalesced, not a direct call to `notify` - a fast pointer (pen/spray tools especially,
    // see paintCell/sprayTick) can call reactNotify() many times between two browser paints, and
    // every one of those was forcing a full React re-render (the whole editor panel: layer/frame
    // thumbnails, sprite library, etc.), most of which the browser would just throw away unseen at
    // the next paint anyway. Collapsing bursts to at most once per frame doesn't change what any
    // caller reads (state is always read live off this engine's own fields at render time, never a
    // snapshotted arg), only how many times React redoes that read - it's a pure waste cut, not a
    // behavior change. The canvas itself is unaffected: drawGrid() is still called synchronously,
    // immediately, everywhere it already was - only the React-rendered side panels/DOM overlays defer
    // to the next frame, which is invisible since they can't paint faster than that anyway.
    this.reactNotify = () => {
      if (this.notifyRafId !== null) return;
      this.notifyRafId = requestAnimationFrame(() => {
        this.notifyRafId = null;
        notify();
      });
    };
    const loaded = storage.loadSprites();
    if (loaded === null) {
      this.sprites = storage.buildDefaultSprites();
      storage.saveSprites(this.sprites);
    } else {
      this.sprites = loaded;
    }
    this.paletteColors = storage.loadPaletteColors() ?? [...DEFAULT_PALETTE_COLORS];
    this.savedColors = storage.loadSavedColors();
    this.canvasBackground = storage.loadCanvasBackground() ?? 'checker-dark';
    this.brushSizes = storage.loadBrushSizes();

    this.restartPreviewTimer();

    const endGesture = () => this.onPointerUp();
    const forceEndGesture = () => {
      this.middlePanActive = false;
      this.middlePanLast = null;
      if (!this.painting) return;
      this.resetGestureState();
      this.refresh();
    };
    const onVisibility = () => {
      if (document.hidden) forceEndGesture();
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!this.dirty) return;
      e.preventDefault();
      e.returnValue = '';
    };
    const onKeyDownGlobal = (e: KeyboardEvent) => this.onKeyDown(e);

    window.addEventListener('pointerup', endGesture);
    window.addEventListener('pointercancel', endGesture);
    window.addEventListener('blur', forceEndGesture);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('keydown', onKeyDownGlobal);

    this.windowListeners = [
      () => window.removeEventListener('pointerup', endGesture),
      () => window.removeEventListener('pointercancel', endGesture),
      () => window.removeEventListener('blur', forceEndGesture),
      () => document.removeEventListener('visibilitychange', onVisibility),
      () => window.removeEventListener('beforeunload', onBeforeUnload),
      () => document.removeEventListener('keydown', onKeyDownGlobal),
    ];

    this.reactNotify();
  }

  destroy(): void {
    if (this.previewTimer) clearInterval(this.previewTimer);
    if (this.sprayTimer) clearInterval(this.sprayTimer);
    // Reset to null, not just cancelled - React 18 StrictMode's dev-mode double-invoke (mount →
    // cleanup → mount again) means a fresh init() can follow this destroy() in the same tick. Its
    // new reactNotify closure still reads this same instance field, so leaving a stale (cancelled,
    // never-firing) id here would make every reactNotify() call after that second init() see "a
    // notify is already pending" and permanently no-op - the exact bug that motivated this comment.
    if (this.notifyRafId !== null) {
      cancelAnimationFrame(this.notifyRafId);
      this.notifyRafId = null;
    }
    this.windowListeners.forEach((off) => off());
    this.windowListeners = [];
  }

  /**
   * A pending curve's bezier preview lives in shapePreviewCells across mouse-up (unlike line/rect/
   * ellipse, which commit and clear it immediately) so it must keep rendering here too - otherwise
   * the curve preview vanishes the instant a bend-adjustment drag ends, leaving only the handle.
   */
  private refresh(): void {
    this.drawGrid(this.shapePreviewCells ?? undefined);
    this.reactNotify();
  }

  attachCanvas(el: HTMLCanvasElement | null): void {
    this.canvas = el;
    this.ctx = el ? el.getContext('2d') : null;
    if (el) {
      this.recomputeCanvasSize();
      this.drawGrid(this.shapePreviewCells ?? undefined);
    }
  }

  attachPreviewCanvas(el: HTMLCanvasElement | null): void {
    this.previewCanvas = el;
    this.previewCtx = el ? el.getContext('2d') : null;
  }

  setActive(active: boolean): void {
    this.active = active;
  }

  effectiveCellPx(): number {
    return BASE_CELL_PX * this.zoomScale;
  }

  /** A canvas's max zoom scales down as its own dimensions grow, so the on-screen size (width×cellPx)
   *  never blows past a sane pixel count regardless of how large the sprite is - a tiny sprite can
   *  zoom in much further (up to MAX_ZOOM_SCALE) than a background-sized one. Never below 4x even for
   *  a canvas at MAX_BACKGROUND_GRID_SIZE, so "zoom in" is never fully dead on a huge canvas. */
  maxZoomScale(): number {
    const maxDim = Math.max(this.current.width, this.current.height);
    return Math.max(4, Math.min(MAX_ZOOM_SCALE, MAX_RENDERED_CANVAS_PX / (maxDim * BASE_CELL_PX)));
  }

  minZoomScale(): number {
    return MIN_ZOOM_SCALE;
  }

  recomputeCanvasSize(): void {
    if (!this.canvas) return;
    const { width, height } = this.current;
    // The canvas's own bitmap is native resolution - exactly 1 pixel per cell (e.g. 1400×900, not
    // 1400×900 *cellPx*) - with CSS doing the zoom (updateCanvasCssSize, plus .pixelated's
    // image-rendering: pixelated for a crisp, un-blurred scale-up). Zooming or scrolling a huge
    // canvas is then a free GPU compositor operation, not a JS re-render: the old approach (bitmap
    // sized to width*cellPx) meant a background-sized canvas at typical zoom was allocating tens of
    // millions of physical pixels, all of which had to be re-cleared and re-blitted on every single
    // pointer move while painting - that's what made painting on a large canvas visibly lag. Grid
    // lines, symmetry guides, the selection-draft marquee, and the curve control handle all moved to
    // a DOM overlay (PixelSelectionOverlay.tsx) as a consequence: at 1px-per-cell there's no room to
    // draw a hairline *between* cells, or a fixed-size (e.g. 6px) handle glyph, on this canvas itself.
    // Skipped when the sprite's own dimensions haven't changed (see setZoom) - assigning canvas.width/
    // height always resets the bitmap to transparent regardless of whether the value actually differs,
    // so doing it on every zoom tick would force a full repaint for a change that never touches a
    // single pixel of actual content, only the CSS scale.
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      // Resizing width/height (above) resets all context state, including this - must be re-applied
      // every time, not just once at creation.
      if (this.ctx) this.ctx.imageSmoothingEnabled = false;
    }
    this.updateCanvasCssSize();
  }

  /** Just the on-screen (CSS) size - the half of recomputeCanvasSize that a pure zoom change (sprite
   *  dimensions unchanged) actually needs, without also touching (and clearing) the canvas bitmap. */
  private updateCanvasCssSize(): void {
    if (!this.canvas) return;
    const { width, height } = this.current;
    const cellPx = this.effectiveCellPx();
    this.canvas.style.width = `${width * cellPx}px`;
    this.canvas.style.height = `${height * cellPx}px`;
    this.canvas.style.backgroundSize = `${cellPx * 2}px ${cellPx * 2}px`;
  }

  zoomLabel(): string {
    return `${Math.round(this.zoomScale * 100)}%`;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  // --- tool / color / toggles ---

  setTool(tool: ToolName): void {
    if (tool === this.tool) return;
    if (this.tool === 'curve' && this.curvePhase) this.commitCurve();
    if (this.tool === 'spray') this.stopSprayTimer();
    this.tool = tool;
    if (this.canvas && !SELECTION_AWARE_TOOLS.has(tool)) this.canvas.style.cursor = '';
    this.reactNotify();
  }

  setColor(color: string): void {
    this.color = color;
    if (this.tool === 'eyedropper') this.tool = 'pen';
    this.reactNotify();
  }

  removePaletteColor(color: string): void {
    if (!this.paletteColors.includes(color)) return;
    this.paletteColors = this.paletteColors.filter((c) => c !== color);
    storage.savePaletteColors(this.paletteColors);
    this.reactNotify();
  }

  addSavedColor(color: string): void {
    if (this.savedColors.includes(color)) return;
    this.savedColors = [...this.savedColors, color];
    storage.saveSavedColors(this.savedColors);
    this.reactNotify();
  }

  removeSavedColor(color: string): void {
    if (!this.savedColors.includes(color)) return;
    this.savedColors = this.savedColors.filter((c) => c !== color);
    storage.saveSavedColors(this.savedColors);
    this.reactNotify();
  }

  setShapeFilled(v: boolean): void {
    this.shapeFilled = v;
    this.reactNotify();
  }

  setShowGrid(v: boolean): void {
    this.showGrid = v;
    this.refresh();
  }

  setCanvasBackground(bg: CanvasBackground): void {
    this.canvasBackground = bg;
    storage.saveCanvasBackground(bg);
    this.reactNotify();
  }

  setOnionSkin(v: boolean): void {
    this.onionSkin = v;
    this.refresh();
  }

  setSymmetry(mode: SymmetryMode): void {
    this.symmetry = mode;
    this.refresh();
  }

  /** Which brush-size slot the active tool reads/writes - tools outside BRUSH_SIZE_TOOLS (shapes,
   *  fill, etc.) fall back to the pen's size since they never read `brushSize` in the first place. */
  private brushSizeToolKey(): string {
    return BRUSH_SIZE_TOOLS.has(this.tool) ? this.tool : 'pen';
  }

  get brushSize(): number {
    return this.brushSizes[this.brushSizeToolKey()] ?? 1;
  }

  setBrushSize(size: number): void {
    const clamped = Math.min(MAX_BRUSH_SIZE, Math.max(1, Math.round(size)));
    if (clamped === this.brushSize) return;
    this.brushSizes = { ...this.brushSizes, [this.brushSizeToolKey()]: clamped };
    storage.saveBrushSizes(this.brushSizes);
    this.reactNotify();
  }

  /** Tracks the pointer for the brush-footprint preview outline (see brushPreviewRect) - called on
   *  every pointer move over the canvas regardless of tool/painting state, not just while a brush tool
   *  is active, so switching tools while the pointer is already over the canvas shows the outline
   *  immediately instead of only after the next move. */
  updateHoverPointer(e: { clientX: number; clientY: number }): void {
    const pt = this.pxFromEvent(e);
    if (!pt) return;
    this.hoverPointerPx = pt;
    if (BRUSH_SIZE_TOOLS.has(this.tool)) this.reactNotify();
  }

  clearHoverPointer(): void {
    if (!this.hoverPointerPx) return;
    this.hoverPointerPx = null;
    this.reactNotify();
  }

  /** Where PixelSelectionOverlay.tsx should draw the brush-footprint preview outline: a `brushSize`
   *  cells-wide square, snapped to the same top-left-anchored cell grid brushCellsAt paints (see its
   *  doc comment) - so the outline shows exactly which cells a click would paint, not just an
   *  approximate box centered on the raw pointer position. Null when there's nothing to show (pointer
   *  not over the canvas, or the active tool doesn't use a brush size). */
  brushPreviewRect(): { left: number; top: number; size: number } | null {
    if (!this.hoverPointerPx || !BRUSH_SIZE_TOOLS.has(this.tool)) return null;
    const cellPx = this.effectiveCellPx();
    const cellX = Math.floor(this.hoverPointerPx.px / cellPx);
    const cellY = Math.floor(this.hoverPointerPx.py / cellPx);
    const off = Math.floor((this.brushSize - 1) / 2);
    return {
      left: (cellX - off) * cellPx,
      top: (cellY - off) * cellPx,
      size: this.brushSize * cellPx,
    };
  }

  setGradientColor(color: string): void {
    this.gradientColor = color;
    this.reactNotify();
  }

  setTransformAllFrames(v: boolean): void {
    this.transformAllFrames = v;
    this.reactNotify();
  }

  /**
   * Sets a new continuous zoom scale, clamped to [minZoomScale(), maxZoomScale()] - the single place
   * that ever changes zoomScale. When `anchor` (client coords, e.g. the cursor position) is given, the
   * content point under it is kept at the same screen position ("zoom to cursor") by measuring where
   * that point actually rendered before and after the resize, then correcting the gap (see
   * absorbPanCorrection) via the wrap's native scrollLeft/scrollTop wherever there's room for it, and
   * only the leftover via panX/panY - a small transform applied to .pixel-canvas-inner (see
   * PixelCanvas.tsx). panX/panY exists at all because .pixel-canvas-wrap centers its content via CSS
   * grid `place-items: center` whenever the canvas is smaller than the wrap (the common case for most
   * sprites at ordinary zoom levels), and in that regime scrollLeft/scrollTop are pinned at 0 with no
   * scrollable slack to adjust - writing to them is silently a no-op, so that case has to be corrected
   * some other way. Measuring the canvas's actual rendered rect sidesteps needing to know which regime
   * applies: it's correct whether the current position comes from centering, native scroll, a prior
   * panX/panY, or any mix of the three, since getBoundingClientRect() always reports the final on-screen
   * result of all of them together.
   *
   * Deliberately does NOT call recomputeCanvasSize()/drawGrid(): a zoom change never touches the
   * sprite's own dimensions or pixel content, only how large it's drawn on screen and where the DOM
   * selection/grid overlay (which reads effectiveCellPx() at React render time) sits - so only the CSS
   * size, the pan correction, and a reactNotify() are needed, not a full canvas-bitmap reset and repaint.
   * That distinction is what keeps continuous scroll-zoom smooth: see PixelCanvas.tsx's wheel handler,
   * the only caller that can invoke this many times in a single animation frame.
   */
  setZoom(scale: number, anchor?: { clientX: number; clientY: number }): void {
    const clamped = Math.min(this.maxZoomScale(), Math.max(this.minZoomScale(), scale));
    if (clamped === this.zoomScale) return;
    const rectBefore = anchor && this.canvas ? this.canvas.getBoundingClientRect() : null;
    this.zoomScale = clamped;
    this.updateCanvasCssSize();
    if (rectBefore && anchor && this.canvas && rectBefore.width > 0 && rectBefore.height > 0) {
      // Where the cursor sits as a fraction across the canvas's old on-screen box - fraction, not an
      // absolute cell/px position, so it's meaningful before and after the size actually changes.
      const fracX = (anchor.clientX - rectBefore.left) / rectBefore.width;
      const fracY = (anchor.clientY - rectBefore.top) / rectBefore.height;
      const rectAfter = this.canvas.getBoundingClientRect();
      const naturalX = rectAfter.left + fracX * rectAfter.width;
      const naturalY = rectAfter.top + fracY * rectAfter.height;
      // That same fraction now naturally renders at (naturalX, naturalY) - wherever CSS centering/
      // scroll/the previous panX,panY happened to land it - which has drifted from the cursor by
      // exactly (naturalX - anchor.clientX, naturalY - anchor.clientY); absorbPanCorrection closes that
      // gap. rectAfter's own width/height (the canvas's true CSS size, set moments ago by
      // updateCanvasCssSize() and unaffected by any transform on its ancestor - translate doesn't
      // resize anything) go with it, not read fresh from the DOM again there - see that method's doc
      // comment for why re-deriving "does this overflow" from the wrap itself is the wrong check.
      this.absorbPanCorrection(naturalX - anchor.clientX, naturalY - anchor.clientY, rectAfter.width, rectAfter.height);
    }
    this.reactNotify();
  }

  /**
   * Applies a (dx, dy) screen-px correction - "content needs to shift left/up by this much to bring the
   * zoom anchor back under the cursor" - through the wrap's native scroll whenever the canvas's own true
   * size (`canvasWidth`/`canvasHeight`, from the caller's already-measured rect) exceeds the wrap's
   * client size on that axis, draining any pan already sitting in the transform back into scroll at the
   * same time (see `oldPanX`/`oldPanY` below) instead of just adding to it. Falls back to the panX/panY
   * transform only when the canvas genuinely fits (CSS grid `place-items: center` has scrollLeft/Top
   * pinned at 0 there - the one case a transform is unavoidable).
   *
   * Deliberately does NOT ask the wrap "do you currently have scrollable overflow" (e.g.
   * `scrollWidth > clientWidth`) to decide this - scrollWidth includes the *transformed* position of a
   * nonzero panX/panY, so a large enough pan alone can make scrollWidth exceed clientWidth even while
   * the canvas's own untransformed size still fits: confirmed by reproducing exactly that (zooming into
   * a small sprite, where after a couple of steps panX had grown just large enough to flip that check
   * true a step early, at which point the untransformed canvas still didn't actually overflow, scroll
   * couldn't do anything useful with the "room" that check saw, and the cursor anchor drifted ~15% of
   * the canvas's width on the next step and stayed drifted). Comparing the canvas's own transform-
   * independent size against the wrap's clientWidth/Height sidesteps that feedback loop entirely.
   *
   * Separately, a transform and native scroll both contribute to a scroll container's overflow area,
   * but independently, and the browser doesn't reconcile them: once panX/panY holds a large offset *and*
   * the canvas is also large enough to genuinely overflow the wrap, scrollWidth/scrollHeight balloon to
   * cover both the untransformed and transformed positions, and neither scrollLeft=0, scrollLeft=max,
   * nor the midpoint between them still means "left/right/center edge of the visible canvas" - confirmed
   * by reproducing that too (zoom out from 100% while anchored off-center down to the 5% minimum left
   * panX/panY at several thousand px, at which point even scrolling to the wrap's own scrollWidth/2
   * landed the canvas over a thousand px from the wrap's center). Draining into scroll whenever the
   * canvas genuinely overflows avoids this the same way it avoids the other feedback loop above.
   *
   * Whenever scroll applies, this deliberately lets the browser's own clamping (scrollLeft/Top always
   * self-clamp to [0, scrollWidth-clientWidth]) have the final say and discards anything the clamp
   * couldn't satisfy, rather than pushing the shortfall into panX/panY to preserve the anchor exactly.
   * That shortfall is only ever nonzero when perfectly honoring the anchor would mean scrolling past the
   * canvas's own edge - content that doesn't exist - so the trade is a marginal, edge-only loss of
   * cursor-anchor precision (confirmed: same order of magnitude whether reached in one zoom step or many
   * small ones, i.e. a real geometric floor, not accumulated drift) in exchange for scrollLeft/Top always
   * meaning exactly what they say, which is what the reported bug actually needs guaranteed.
   */
  private absorbPanCorrection(dx: number, dy: number, canvasWidth: number, canvasHeight: number): void {
    const inner = this.canvas?.parentElement as HTMLElement | null;
    const wrap = inner?.parentElement as HTMLElement | null;
    if (!wrap || !inner) {
      this.panX -= dx;
      this.panY -= dy;
      return;
    }
    const oldPanX = this.panX;
    const oldPanY = this.panY;
    const useScrollX = canvasWidth > wrap.clientWidth;
    const useScrollY = canvasHeight > wrap.clientHeight;
    this.panX = useScrollX ? 0 : oldPanX - dx;
    this.panY = useScrollY ? 0 : oldPanY - dy;
    // Written to the DOM directly here, synchronously, rather than left for React's next render:
    // scrollLeft/Top's assignments just below auto-clamp against the wrap's *current* scrollWidth/
    // Height, which still include whatever transform is actually on the element right now - if that's
    // still last render's (larger) panX/panY because React hasn't re-rendered yet, the clamp would use a
    // stale, inflated bound, and the value actually assigned would only turn out wrong once React's own
    // render later swaps in the smaller/zero transform computed above and the browser re-clamps against
    // the now-current (smaller) scrollWidth. React reads this same panX/panY on its own next render and
    // writes the identical style, so this isn't a fight with it, just staying in sync one tick sooner
    // than a render would - the same reasoning as this method reading getBoundingClientRect() directly
    // instead of waiting on a render.
    inner.style.transform = this.panX || this.panY ? `translate(${this.panX}px, ${this.panY}px)` : '';
    if (useScrollX) wrap.scrollLeft += dx - oldPanX;
    if (useScrollY) wrap.scrollTop += dy - oldPanY;
  }

  /** Multiplicative zoom-button step (see ZOOM_BUTTON_STEP), anchored at the wrap's own visible center
   *  so the view stays centered on whatever's already on screen instead of jumping toward the origin. */
  private zoomAtViewportCenter(scale: number): void {
    const wrap = this.canvas?.parentElement?.parentElement as HTMLElement | null;
    if (!wrap) {
      this.setZoom(scale);
      return;
    }
    const rect = wrap.getBoundingClientRect();
    this.setZoom(scale, { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 });
  }

  zoomIn(): void {
    this.zoomAtViewportCenter(this.zoomScale * ZOOM_BUTTON_STEP);
  }

  zoomOut(): void {
    this.zoomAtViewportCenter(this.zoomScale / ZOOM_BUTTON_STEP);
  }

  /** Sets a continuous zoom scale that shows the whole canvas inside .pixel-canvas-wrap without
   *  scrolling - unlike ZOOM_LEVELS' largest preset step, which still isn't nearly small enough for a
   *  large canvas (e.g. a 1400×900 background). Reads the wrap element's current size straight from
   *  the DOM (via this.canvas's own parents) rather than needing a ResizeObserver plumbed in from the
   *  component - this is a one-shot fit-right-now action, not an ambient always-fit mode, so there's
   *  nothing to keep in sync between clicks. */
  zoomToFit(): void {
    const wrap = this.canvas?.parentElement?.parentElement;
    if (!wrap) return;
    const cs = getComputedStyle(wrap);
    const availW = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const availH = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (availW <= 0 || availH <= 0) return;
    const { width, height } = this.current;
    const scale = Math.min(availW / (width * BASE_CELL_PX), availH / (height * BASE_CELL_PX));
    this.panX = 0;
    this.panY = 0;
    this.setZoom(scale);
  }

  private defaultZoomForSize(maxDim: number): number {
    return Math.min(this.maxZoomScale(), maxDim >= 32 ? 0.75 : 1);
  }

  /**
   * `type` is the sprite-type dropdown's own live (possibly unsaved) value, not necessarily
   * this.current.type - CanvasMetaBar.tsx keeps a sprite's name/type as a draft in React state until
   * "Save to library", so a user can switch the dropdown to 'background' and try to resize before ever
   * saving. Clamping here (not just in the UI that calls this) is what makes the 300x300 background
   * floor unbypassable - this is the only place that ever actually changes width/height, confirmed via
   * a repo-wide search for other callers.
   */
  setGridSize(newWidth: number, newHeight: number, type: SpriteType): void {
    const minSize = type === 'background' ? storage.MIN_BACKGROUND_GRID_SIZE : storage.MIN_GRID_SIZE;
    const clampedWidth = Math.max(minSize, newWidth);
    const clampedHeight = Math.max(minSize, newHeight);
    if (clampedWidth === this.current.width && clampedHeight === this.current.height) return;
    this.pushUndo();
    const { width, height } = this.current;
    this.current.frames = this.current.frames.map((layers) =>
      layers.map((layer) => ({ ...layer, cells: storage.resampleFrame(layer.cells, width, height, clampedWidth, clampedHeight) }))
    );
    this.current.width = clampedWidth;
    this.current.height = clampedHeight;
    this.zoomScale = this.defaultZoomForSize(Math.max(clampedWidth, clampedHeight));
    this.panX = 0;
    this.panY = 0;
    this.frameIndex = Math.min(this.frameIndex, this.current.frames.length - 1);
    this.selection = null;
    this.lassoPoints = null;
    this.selectionMask = null;
    this.recomputeCanvasSize();
    this.refresh();
  }

  // --- layers ---

  private layers(): Layer[] {
    return this.current.frames[this.frameIndex];
  }

  private activeLayer(): Layer {
    const layers = this.layers();
    return layers[Math.min(this.activeLayerIndex, layers.length - 1)];
  }

  private activeCells(): Frame {
    return this.activeLayer().cells;
  }

  addLayer(): void {
    if (this.layers().length >= LAYER_LIMIT) return;
    this.pushUndo();
    const { width, height } = this.current;
    const layers = this.layers();
    layers.push(storage.makeLayer(storage.emptyFrame(width, height), `Layer ${layers.length + 1}`));
    this.activeLayerIndex = layers.length - 1;
    this.refresh();
  }

  duplicateLayer(index: number): void {
    if (this.layers().length >= LAYER_LIMIT) return;
    this.pushUndo();
    const layers = this.layers();
    const cloned: Layer = structuredClone(layers[index]);
    cloned.id = storage.uid('layer');
    cloned.name = `${layers[index].name} copy`;
    layers.splice(index + 1, 0, cloned);
    this.activeLayerIndex = index + 1;
    this.refresh();
  }

  renameLayer(index: number, name: string): void {
    const trimmed = name.trim();
    if (!trimmed || trimmed === this.layers()[index].name) return;
    this.pushUndo();
    this.layers()[index].name = trimmed;
    this.refresh();
  }

  deleteLayer(index: number): void {
    const layers = this.layers();
    if (layers.length <= 1) return;
    this.pushUndo();
    layers.splice(index, 1);
    this.activeLayerIndex = Math.min(this.activeLayerIndex, layers.length - 1);
    this.refresh();
  }

  selectLayer(index: number): void {
    this.activeLayerIndex = index;
    this.reactNotify();
  }

  setLayerVisible(index: number, visible: boolean): void {
    this.pushUndo();
    this.layers()[index].visible = visible;
    this.refresh();
  }

  /** Opacity changes are pushed to undo once by the UI (on drag start), not on every tick. */
  setLayerOpacity(index: number, opacity: number): void {
    this.layers()[index].opacity = Math.min(1, Math.max(0, opacity));
    this.refresh();
  }

  moveLayer(from: number, to: number): void {
    const layers = this.layers();
    if (from === to || from < 0 || to < 0 || from >= layers.length || to >= layers.length) return;
    this.pushUndo();
    const [moved] = layers.splice(from, 1);
    layers.splice(to, 0, moved);
    if (this.activeLayerIndex === from) this.activeLayerIndex = to;
    else if (from < this.activeLayerIndex && to >= this.activeLayerIndex) this.activeLayerIndex -= 1;
    else if (from > this.activeLayerIndex && to <= this.activeLayerIndex) this.activeLayerIndex += 1;
    this.refresh();
  }

  /** Merges a layer into the one below it (its visible pixels win over the layer beneath). */
  mergeLayerDown(index: number): void {
    const layers = this.layers();
    if (index <= 0 || index >= layers.length) return;
    this.pushUndo();
    const top = layers[index];
    const bottom = layers[index - 1];
    if (top.visible) {
      bottom.cells = bottom.cells.map((c, i) => top.cells[i] ?? c);
    }
    layers.splice(index, 1);
    this.activeLayerIndex = Math.min(this.activeLayerIndex, layers.length - 1);
    this.refresh();
  }

  layerLimitReached(): boolean {
    return this.layers().length >= LAYER_LIMIT;
  }

  deselect(): void {
    if (!this.selection) return;
    this.selection = null;
    this.lassoPoints = null;
    this.selectionMask = null;
    this.reactNotify();
  }

  // --- frames ---

  selectFrame(i: number): void {
    this.frameIndex = i;
    this.activeLayerIndex = Math.min(this.activeLayerIndex, this.current.frames[i].length - 1);
    if (this.curvePhase) this.clearCurveState();
    this.refresh();
  }

  addFrame(): void {
    if (this.current.frames.length >= FRAME_LIMIT) return;
    this.pushUndo();
    const { width, height } = this.current;
    this.current.frames.push([storage.makeLayer(storage.emptyFrame(width, height))]);
    this.frameIndex = this.current.frames.length - 1;
    this.activeLayerIndex = 0;
    this.refresh();
  }

  dupFrame(): void {
    if (this.current.frames.length >= FRAME_LIMIT) return;
    this.pushUndo();
    const cloned: Layer[] = structuredClone(this.current.frames[this.frameIndex]);
    cloned.forEach((layer) => (layer.id = storage.uid('layer')));
    this.current.frames.splice(this.frameIndex + 1, 0, cloned);
    this.frameIndex += 1;
    this.refresh();
  }

  delFrame(): void {
    if (this.current.frames.length <= 1) return;
    this.pushUndo();
    this.current.frames.splice(this.frameIndex, 1);
    this.frameIndex = Math.max(0, this.frameIndex - 1);
    this.refresh();
  }

  moveFrame(from: number, to: number): void {
    if (from === to || from < 0 || to < 0 || from >= this.current.frames.length || to >= this.current.frames.length) return;
    this.pushUndo();
    const [moved] = this.current.frames.splice(from, 1);
    this.current.frames.splice(to, 0, moved);
    if (this.frameIndex === from) this.frameIndex = to;
    else if (from < this.frameIndex && to >= this.frameIndex) this.frameIndex -= 1;
    else if (from > this.frameIndex && to <= this.frameIndex) this.frameIndex += 1;
    this.refresh();
  }

  clearFrame(): void {
    this.pushUndo();
    const { width, height } = this.current;
    this.activeLayer().cells = storage.emptyFrame(width, height);
    this.refresh();
  }

  frameLimitReached(): boolean {
    return this.current.frames.length >= FRAME_LIMIT;
  }

  // --- transform ---

  /**
   * fn may return new dimensions (e.g. a 90° rotation swaps width/height). All frames share one
   * sprite-wide size, so a dimension-changing transform (`resizesFrame`) always applies to every
   * frame regardless of the "apply to all frames" toggle - otherwise frames would end up with
   * mismatched dimensions.
   */
  transformFrames(
    fn: (f: Frame, width: number, height: number) => { frame: Frame; width: number; height: number },
    resizesFrame = false
  ): void {
    this.pushUndo();
    const { width, height } = this.current;
    let newWidth = width;
    let newHeight = height;
    const transformLayers = (layers: Layer[]): Layer[] =>
      layers.map((layer) => {
        const result = fn(layer.cells, width, height);
        newWidth = result.width;
        newHeight = result.height;
        return { ...layer, cells: result.frame };
      });
    if (this.transformAllFrames || resizesFrame) {
      this.current.frames = this.current.frames.map(transformLayers);
    } else {
      this.current.frames[this.frameIndex] = transformLayers(this.current.frames[this.frameIndex]);
    }
    this.current.width = newWidth;
    this.current.height = newHeight;
    this.selection = null;
    this.lassoPoints = null;
    this.selectionMask = null;
    this.recomputeCanvasSize();
    this.refresh();
  }

  flipH(): void {
    this.transformFrames((f, width, height) => ({ frame: flipFrameH(f, width, height), width, height }));
  }

  flipV(): void {
    this.transformFrames((f, width, height) => ({ frame: flipFrameV(f, width, height), width, height }));
  }

  rotateCW(): void {
    const resizesFrame = this.current.width !== this.current.height;
    this.transformFrames((f, width, height) => rotateFrame(f, width, height, true), resizesFrame);
  }

  rotateCCW(): void {
    const resizesFrame = this.current.width !== this.current.height;
    this.transformFrames((f, width, height) => rotateFrame(f, width, height, false), resizesFrame);
  }

  // --- keyboard ---

  onKeyDown(e: KeyboardEvent): void {
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) return;
    if (!this.active) return;
    if (this.painting) return;

    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && key === 'z' && !e.shiftKey) {
      e.preventDefault();
      this.undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (key === 'y' || (key === 'z' && e.shiftKey))) {
      e.preventDefault();
      this.redo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && key === 'c') {
      e.preventDefault();
      this.copySelection();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && key === 'v') {
      e.preventDefault();
      this.pasteClipboard();
      return;
    }
    if (key === 'escape') {
      if (this.curvePhase) {
        this.cancelCurve();
        return;
      }
      this.deselect();
      return;
    }
    if (key === 'enter' && this.curvePhase === 'bend') {
      this.commitCurve();
      return;
    }
    if (this.selection && (key === 'arrowup' || key === 'arrowdown' || key === 'arrowleft' || key === 'arrowright')) {
      e.preventDefault();
      const dx = key === 'arrowleft' ? -1 : key === 'arrowright' ? 1 : 0;
      const dy = key === 'arrowup' ? -1 : key === 'arrowdown' ? 1 : 0;
      this.nudgeSelection(dx, dy);
      return;
    }
    if (key === '[') {
      this.setBrushSize(this.brushSize - 1);
      return;
    }
    if (key === ']') {
      this.setBrushSize(this.brushSize + 1);
      return;
    }
    if (TOOL_KEYS[key]) {
      this.setTool(TOOL_KEYS[key]);
    }
  }

  // --- pointer / drawing gesture ---

  private cellFromEvent(e: { clientX: number; clientY: number }): Cell | null {
    if (!this.canvas) return null;
    const rect = this.canvas.getBoundingClientRect();
    const cellPx = this.effectiveCellPx();
    const x = Math.floor((e.clientX - rect.left) / cellPx);
    const y = Math.floor((e.clientY - rect.top) / cellPx);
    const { width, height } = this.current;
    if (x < 0 || y < 0 || x >= width || y >= height) return null;
    return { x, y };
  }

  private commitMove(): void {
    if (!this.moveBuffer) return;
    const { dx, dy } = this.moveDelta;
    const { width, height } = this.current;
    const frame = this.activeCells();
    this.moveBuffer.cells.forEach((c) => {
      const nx = c.x + dx;
      const ny = c.y + dy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height) frame[ny * width + nx] = c.color;
    });
    if (this.selection) this.selection = shiftBox(this.selection, this.moveDelta);
    if (this.lassoPoints) {
      this.lassoPoints = this.lassoPoints.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      this.selectionMask = this.polygonMask(this.lassoPoints);
    }
    this.moveBuffer = null;
    this.moveStartCell = null;
    this.moveDelta = { dx: 0, dy: 0 };
    this.gestureBaseBitmap = null;
    this.refresh();
  }

  private resetGestureState(): void {
    // A pending move/resize already cleared its source cells from the frame data
    // at gesture start, so an interrupted gesture must be committed back (at its
    // last known position), never just discarded - dropping it would silently
    // delete the pixels the user picked up.
    if (this.moveBuffer) this.commitMove();
    if (this.resizeHandle) this.commitResize();
    if (this.rotateOrigin) this.commitRotate();
    this.painting = false;
    this.lastPaintCell = null;
    this.shapeStart = null;
    // redrawShapePreview(null), not a bare field assignment - an interrupted shape/curve drag can
    // leave a preview actually painted on the canvas (see redrawShapePreview's dirty-rect repaint),
    // and unlike the old full-canvas drawGrid() (which erased it as a side effect of repainting
    // everything), a targeted repaint needs telling to actually erase that region. A no-op, at the
    // cost of one bounding-box check, when there was nothing being previewed.
    this.redrawShapePreview(null);
    this.selectStart = null;
    this.selectionDraft = null;
    this.lassoDraftPoints = null;
    this.moveBuffer = null;
    this.moveStartCell = null;
    this.moveDelta = { dx: 0, dy: 0 };
    this.resizeHandle = null;
    this.resizeOrigin = null;
    this.resizeSource = null;
    this.resizePreview = null;
    this.rotateOrigin = null;
    this.rotateSource = null;
    this.rotatePreview = null;
    this.rotateAngle = 0;
    this.gestureBaseBitmap = null;
    this.eraseOverride = false;
    this.strokeSnapshot = null;
    this.strokePoints = [];
    if (this.curvePhase === 'drag-end' || this.curveDraggingControl) {
      this.curveStart = null;
      this.curveEnd = null;
      this.curveControl = null;
      this.curvePhase = null;
      this.curveDraggingControl = false;
    }
    if (this.gradientStart) {
      // Same reasoning as redrawShapePreview(null) above: drawGradientPreviewOverlay() paints straight
      // onto the canvas bitmap without a preceding clear (see its own doc comment), so an interrupted
      // gradient drag needs an explicit repaint of the box it covered, not just clearing the state that
      // used to describe it.
      this.redrawRegions([this.selection ?? { x0: 0, y0: 0, x1: this.current.width - 1, y1: this.current.height - 1 }]);
    }
    this.gradientStart = null;
    this.gradientEnd = null;
    this.gradientPreview = null;
    this.stopSprayTimer();
  }

  private pxFromEvent(e: { clientX: number; clientY: number }): { px: number; py: number } | null {
    if (!this.canvas) return null;
    const rect = this.canvas.getBoundingClientRect();
    return { px: e.clientX - rect.left, py: e.clientY - rect.top };
  }

  private selectionCenterPx(box: SelectionBox, cellPx: number): { cx: number; cy: number } {
    const x0 = box.x0 * cellPx;
    const y0 = box.y0 * cellPx;
    const x1 = (box.x1 + 1) * cellPx;
    const y1 = (box.y1 + 1) * cellPx;
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  }

  /** Distance from the selection center to the rotate handle: half the box height plus a fixed screen-space gap. */
  private rotateHandleRadius(box: SelectionBox, cellPx: number): number {
    return ((box.y1 - box.y0 + 1) * cellPx) / 2 + ROTATE_HANDLE_OFFSET;
  }

  /** Unclamped - the rotate handle is a DOM element (see PixelSelectionOverlay.tsx), not drawn on
   *  this <canvas>, specifically so it stays visible/grabbable above the selection even when that
   *  puts it outside the canvas's own bitmap (e.g. a selection flush against the top edge) - it's
   *  only ever clipped by .pixel-canvas-wrap now, same "beyond the frame, into the surrounding
   *  chrome" treatment as the tank's own background rotate handle. */
  private rotateHandlePos(box: SelectionBox, cellPx: number): { hx: number; hy: number } {
    const { cx, cy } = this.selectionCenterPx(box, cellPx);
    const r = this.rotateHandleRadius(box, cellPx);
    const ang = -Math.PI / 2 + this.rotateAngle;
    return { hx: cx + r * Math.cos(ang), hy: cy + r * Math.sin(ang) };
  }

  /** Whether a click is close enough to the curve's control-point handle to grab it, rather than committing the curve. */
  private isNearCurveControl(e: { clientX: number; clientY: number }): boolean {
    if (!this.curveControl) return false;
    const pt = this.pxFromEvent(e);
    if (!pt) return false;
    const cellPx = this.effectiveCellPx();
    const hx = (this.curveControl.x + 0.5) * cellPx;
    const hy = (this.curveControl.y + 0.5) * cellPx;
    const tol = Math.max(cellPx, ROTATE_HIT_RADIUS * 1.5);
    return Math.hypot(pt.px - hx, pt.py - hy) <= tol;
  }

  /** Unclamped - unlike cellFromEvent/cellFromEventClamped, never returns null and never pins the
   *  result to [0,width)x[0,height): move and resize drags (see updateResizeDrag, the moveBuffer
   *  branch of onPointerMove) need to keep tracking the pointer past the canvas's own edge, so the
   *  selection box can be dragged/stretched fully outside the sprite - same free-form floating
   *  selection Microsoft Paint allows, rather than pinning the box to the visible bitmap. */
  private cellFromEventUnclamped(e: { clientX: number; clientY: number }): Cell {
    const rect = this.canvas!.getBoundingClientRect();
    const cellPx = this.effectiveCellPx();
    const x = Math.floor((e.clientX - rect.left) / cellPx);
    const y = Math.floor((e.clientY - rect.top) / cellPx);
    return { x, y };
  }

  private isInsideSelection(cell: Cell): boolean {
    if (!this.selection) return false;
    const box = this.selection;
    if (cell.x < box.x0 || cell.x > box.x1 || cell.y < box.y0 || cell.y > box.y1) return false;
    if (this.selectionMask) return this.selectionMask.has(`${cell.x},${cell.y}`);
    return true;
  }

  private startMoveGesture(cell: Cell): void {
    this.pushUndo();
    this.painting = true;
    const { width, height } = this.current;
    const frame = this.activeCells();
    const box = this.selection || { x0: 0, y0: 0, x1: width - 1, y1: height - 1 };
    const cells: MoveBufferCell[] = [];
    for (let y = box.y0; y <= box.y1; y++) {
      for (let x = box.x0; x <= box.x1; x++) {
        if (this.selectionMask && !this.selectionMask.has(`${x},${y}`)) continue;
        const c = frame[y * width + x];
        if (c) cells.push({ x, y, color: c });
        frame[y * width + x] = null;
      }
    }
    this.moveBuffer = { cells };
    this.moveStartCell = cell;
    this.moveDelta = { dx: 0, dy: 0 };
    this.cacheGestureBaseBitmap();
    this.refresh();
  }

  /** Snapshots everything except the moving layer's cleared-out source region onto gestureBaseBitmap,
   *  so drawGrid() can blit it with one drawImage() per move/resize/rotate frame instead of re-running
   *  paintLayers() over every layer on every pointer move - see gestureBaseBitmap's own doc comment. */
  private cacheGestureBaseBitmap(): void {
    const { width, height } = this.current;
    if (!this.gestureBaseBitmap) this.gestureBaseBitmap = document.createElement('canvas');
    const bmp = this.gestureBaseBitmap;
    if (bmp.width !== width || bmp.height !== height) {
      bmp.width = width;
      bmp.height = height;
    }
    const bctx = bmp.getContext('2d')!;
    bctx.clearRect(0, 0, width, height);
    paintLayers(bctx, this.layers(), width, height, 1);
  }

  /** Masked-out cells (outside a lasso's actual shape but inside its bounding box) read as null/
   *  transparent regardless of what's really painted there, so move/resize/rotate/copy all naturally
   *  carry only the lassoed pixels instead of the whole bounding rectangle. */
  private captureSelectionPixels(box: SelectionBox): (string | null)[][] {
    const frame = this.activeCells();
    const width = this.current.width;
    const rows: (string | null)[][] = [];
    for (let y = box.y0; y <= box.y1; y++) {
      const row: (string | null)[] = [];
      for (let x = box.x0; x <= box.x1; x++) {
        row.push(this.selectionMask && !this.selectionMask.has(`${x},${y}`) ? null : frame[y * width + x]);
      }
      rows.push(row);
    }
    return rows;
  }

  copySelection(): void {
    if (!SELECTION_TOOLS.has(this.tool) || !this.selection) return;
    const box = this.selection;
    this.clipboard = {
      w: box.x1 - box.x0 + 1,
      h: box.y1 - box.y0 + 1,
      rows: this.captureSelectionPixels(box),
    };
  }

  /** Pastes into a new layer (when under the layer limit) rather than the active one, so a paste never overwrites existing work. */
  pasteClipboard(): void {
    if (!this.clipboard) return;
    this.pushUndo();
    const { width, height } = this.current;
    const w = Math.min(this.clipboard.w, width);
    const h = Math.min(this.clipboard.h, height);
    const x0 = Math.max(0, Math.floor((width - w) / 2));
    const y0 = Math.max(0, Math.floor((height - h) / 2));

    const layers = this.layers();
    if (layers.length < LAYER_LIMIT) {
      layers.push(storage.makeLayer(storage.emptyFrame(width, height), `Layer ${layers.length + 1}`));
      this.activeLayerIndex = layers.length - 1;
    }
    const frame = this.activeCells();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        frame[(y0 + y) * width + (x0 + x)] = this.clipboard.rows[y][x];
      }
    }
    this.tool = 'select';
    this.selection = { x0, y0, x1: x0 + w - 1, y1: y0 + h - 1 };
    this.lassoPoints = null;
    this.selectionMask = null;
    this.refresh();
  }

  private clearFrameRegion(box: SelectionBox): void {
    const frame = this.activeCells();
    const width = this.current.width;
    for (let y = box.y0; y <= box.y1; y++) {
      for (let x = box.x0; x <= box.x1; x++) {
        if (this.selectionMask && !this.selectionMask.has(`${x},${y}`)) continue;
        frame[y * width + x] = null;
      }
    }
  }

  private boundingBoxOfPoints(pts: Cell[]): SelectionBox {
    let x0 = pts[0].x, x1 = pts[0].x, y0 = pts[0].y, y1 = pts[0].y;
    pts.forEach((p) => {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y);
      y1 = Math.max(y1, p.y);
    });
    return { x0, y0, x1, y1 };
  }

  /** Even-odd scanline fill of the closed polygon `pts` describes (auto-closed from the last point back
   *  to the first), sampled at each cell's center - the standard way to turn a freehand lasso path into
   *  the set of cells it actually encloses. Bounded to the polygon's own bounding box, not the whole
   *  canvas, since a selection is typically a small fraction of a large one. */
  private polygonMask(pts: Cell[]): Set<string> {
    const box = this.boundingBoxOfPoints(pts);
    const mask = new Set<string>();
    for (let y = box.y0; y <= box.y1; y++) {
      const cy = y + 0.5;
      const crossings: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        if (a.y === b.y) continue;
        if ((cy >= a.y && cy < b.y) || (cy >= b.y && cy < a.y)) {
          crossings.push(a.x + ((cy - a.y) / (b.y - a.y)) * (b.x - a.x));
        }
      }
      crossings.sort((m, n) => m - n);
      for (let i = 0; i + 1 < crossings.length; i += 2) {
        const xStart = Math.max(box.x0, Math.ceil(crossings[i] - 0.5));
        const xEnd = Math.min(box.x1, Math.floor(crossings[i + 1] - 0.5));
        for (let x = xStart; x <= xEnd; x++) mask.add(`${x},${y}`);
      }
    }
    return mask;
  }

  /** Shifts the current selection by exactly (dx, dy) - a discrete, single-step counterpart to the
   *  drag-based startMoveGesture/commitMove, for arrow-key nudging (see onKeyDown). Each press is its
   *  own undo step, same granularity as any other single-shot edit action in this engine. */
  private nudgeSelection(dx: number, dy: number): void {
    if (!this.selection) return;
    this.pushUndo();
    const box = this.selection;
    const { width, height } = this.current;
    const frame = this.activeCells();
    const cells: MoveBufferCell[] = [];
    for (let y = box.y0; y <= box.y1; y++) {
      for (let x = box.x0; x <= box.x1; x++) {
        if (this.selectionMask && !this.selectionMask.has(`${x},${y}`)) continue;
        const c = frame[y * width + x];
        if (c) cells.push({ x, y, color: c });
        frame[y * width + x] = null;
      }
    }
    cells.forEach((c) => {
      const nx = c.x + dx;
      const ny = c.y + dy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height) frame[ny * width + nx] = c.color;
    });
    this.selection = shiftBox(box, { dx, dy });
    if (this.lassoPoints) {
      this.lassoPoints = this.lassoPoints.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      this.selectionMask = this.polygonMask(this.lassoPoints);
    }
    this.refresh();
  }

  private buildResizePreview(source: (string | null)[][], origBox: SelectionBox, newBox: SelectionBox): MoveBufferCell[] {
    const origW = origBox.x1 - origBox.x0 + 1;
    const origH = origBox.y1 - origBox.y0 + 1;
    const newW = newBox.x1 - newBox.x0 + 1;
    const newH = newBox.y1 - newBox.y0 + 1;
    const out: MoveBufferCell[] = [];
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

  private commitResize(): void {
    if (this.resizePreview) {
      const frame = this.activeCells();
      const { width, height } = this.current;
      this.resizePreview.forEach((c) => {
        if (c.x >= 0 && c.y >= 0 && c.x < width && c.y < height) frame[c.y * width + c.x] = c.color;
      });
    }
    // Resize handles only ever render for a plain rectangular marquee (see selectionOverlayBox), so
    // there's no lasso outline/mask to keep in sync here the way commitMove/commitRotate do.
    this.resizeHandle = null;
    this.resizeOrigin = null;
    this.resizeSource = null;
    this.resizePreview = null;
    this.gestureBaseBitmap = null;
  }

  private computeResizedBox(origin: SelectionBox, handle: HandleName, c: Cell): SelectionBox {
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

  /**
   * Inverse-maps each cell of the rotated bounding box back into the captured source region
   * (nearest-neighbor) so the preview has no holes, unlike forward-mapping source pixels. A rotated
   * rectangle never fills its own axis-aligned bounding box - the four corner triangles are
   * genuinely outside the rotated shape - so instead of leaving them empty/checkered, the inverse
   * lookup is clamped to the nearest edge pixel (standard "clamp to edge" extrapolation), stretching
   * each edge's color into the corner it borders rather than showing a hole.
   */
  private computeRotatePreview(angle: number): { cells: MoveBufferCell[]; box: SelectionBox } {
    const origin = this.rotateOrigin!;
    const source = this.rotateSource!;
    const w = origin.x1 - origin.x0 + 1;
    const h = origin.y1 - origin.y0 + 1;
    const cx = origin.x0 + w / 2;
    const cy = origin.y0 + h / 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

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

    const { width: fw, height: fh } = this.current;
    const bx0 = Math.max(0, Math.floor(minX));
    const by0 = Math.max(0, Math.floor(minY));
    const bx1 = Math.min(fw - 1, Math.ceil(maxX) - 1);
    const by1 = Math.min(fh - 1, Math.ceil(maxY) - 1);

    const cells: MoveBufferCell[] = [];
    if (bx1 >= bx0 && by1 >= by0) {
      for (let y = by0; y <= by1; y++) {
        for (let x = bx0; x <= bx1; x++) {
          const relX = x + 0.5 - cx;
          const relY = y + 0.5 - cy;
          const srcRelX = relX * cos + relY * sin;
          const srcRelY = -relX * sin + relY * cos;
          const srcX = Math.min(w - 1, Math.max(0, Math.floor(srcRelX + cx - origin.x0)));
          const srcY = Math.min(h - 1, Math.max(0, Math.floor(srcRelY + cy - origin.y0)));
          const color = source[srcY][srcX];
          if (color) cells.push({ x, y, color });
        }
      }
    }
    const box: SelectionBox = bx1 >= bx0 && by1 >= by0 ? { x0: bx0, y0: by0, x1: bx1, y1: by1 } : origin;
    return { cells, box };
  }

  private commitRotate(): void {
    if (this.rotatePreview) {
      const frame = this.activeCells();
      const { width, height } = this.current;
      this.rotatePreview.forEach((c) => {
        if (c.x >= 0 && c.y >= 0 && c.x < width && c.y < height) frame[c.y * width + c.x] = c.color;
      });
    }
    // Keep a lasso's outline/mask in sync with the same rotation just applied to its pixels - the
    // same forward rotation (by rotateAngle, about rotateOrigin's center) computeRotatePreview used to
    // place each dest pixel, or a subsequent move/copy would use stale, pre-rotation mask coordinates.
    if (this.lassoPoints && this.rotateOrigin) {
      const origin = this.rotateOrigin;
      const cx = origin.x0 + (origin.x1 - origin.x0 + 1) / 2;
      const cy = origin.y0 + (origin.y1 - origin.y0 + 1) / 2;
      const cos = Math.cos(this.rotateAngle);
      const sin = Math.sin(this.rotateAngle);
      this.lassoPoints = this.lassoPoints.map((p) => {
        const rx = p.x - cx;
        const ry = p.y - cy;
        return { x: Math.round(cx + rx * cos - ry * sin), y: Math.round(cy + rx * sin + ry * cos) };
      });
      this.selectionMask = this.polygonMask(this.lassoPoints);
    }
    this.rotateOrigin = null;
    this.rotateSource = null;
    this.rotatePreview = null;
    this.rotateAngle = 0;
    this.gestureBaseBitmap = null;
  }

  /** Where PixelSelectionOverlay.tsx (a DOM layer in .pixel-canvas-wrap, not this <canvas>) should
   *  place the rotate handle and the stalk connecting it to the selection's top edge - null when
   *  there's no settled selection to show it for. See rotateHandlePos for why this is unclamped. */
  selectionRotateHandle(): { mx: number; y0: number; hx: number; hy: number } | null {
    if (!SELECTION_TOOLS.has(this.tool) || !this.selection || this.selectionDraft) return null;
    const cellPx = this.effectiveCellPx();
    // While a move-drag is in progress, this.selection is still the *pre-drag* box (commitMove()
    // only shifts it on release) - use the same live-shifted box the canvas-drawn border and
    // handles track (see the `shown` box in drawGrid), or the handle would float at the old spot
    // while everything else visibly moves with the drag.
    const box = this.moveBuffer ? shiftBox(this.selection, this.moveDelta) : this.selection;
    const x0 = box.x0 * cellPx;
    const y0 = box.y0 * cellPx;
    const x1 = (box.x1 + 1) * cellPx;
    const { hx, hy } = this.rotateHandlePos(box, cellPx);
    return { mx: (x0 + x1) / 2, y0, hx, hy };
  }

  /** Where PixelSelectionOverlay.tsx should draw the selection's dashed border and its 8 resize
   *  handles - both DOM elements now (like the rotate handle above), not drawn on this <canvas>, so
   *  the box stays visible/grabbable even when dragged or stretched fully outside the canvas's own
   *  bitmap (Paint-style floating selection) rather than being clipped to invisibility the moment it
   *  crosses the edge. Live-tracks an in-progress move the same way selectionRotateHandle does. */
  selectionOverlayBox(): { x0: number; y0: number; x1: number; y1: number; handles: { name: HandleName; x: number; y: number }[] } | null {
    // A lasso selection draws its own polygon outline instead (see selectionLassoOutline) - a
    // rectangular border/handles around its bounding box would misrepresent what's actually selected.
    if (!this.selection || this.selectionDraft || this.lassoPoints) return null;
    if (!SELECTION_AWARE_TOOLS.has(this.tool)) return null;
    const cellPx = this.effectiveCellPx();
    const box = this.moveBuffer ? shiftBox(this.selection, this.moveDelta) : this.selection;
    const x0 = box.x0 * cellPx;
    const y0 = box.y0 * cellPx;
    const x1 = (box.x1 + 1) * cellPx;
    const y1 = (box.y1 + 1) * cellPx;
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    // Resize handles imply a rectangular scale, so they only render for the Select tool itself - not
    // while Move (or Lasso) is active, which would show a handle whose own drag start is a no-op.
    const handles: { name: HandleName; x: number; y: number }[] =
      this.tool === 'select'
        ? [
            { name: 'nw', x: x0, y: y0 }, { name: 'n', x: mx, y: y0 }, { name: 'ne', x: x1, y: y0 },
            { name: 'w', x: x0, y: my }, { name: 'e', x: x1, y: my },
            { name: 'sw', x: x0, y: y1 }, { name: 's', x: mx, y: y1 }, { name: 'se', x: x1, y: y1 },
          ]
        : [];
    return { x0, y0, x1, y1, handles };
  }

  /** Where PixelSelectionOverlay.tsx should draw a lasso selection's own outline (marching ants along
   *  the actual lassoed shape, not its bounding box) - the freeform counterpart to selectionOverlayBox
   *  above. Live-tracks an in-progress move the same way that does. */
  selectionLassoOutline(): { points: string } | null {
    if (!this.lassoPoints || this.selectionDraft || !SELECTION_AWARE_TOOLS.has(this.tool)) return null;
    const cellPx = this.effectiveCellPx();
    const { dx, dy } = this.moveBuffer ? this.moveDelta : { dx: 0, dy: 0 };
    const points = this.lassoPoints.map((p) => `${(p.x + dx + 0.5) * cellPx},${(p.y + dy + 0.5) * cellPx}`).join(' ');
    return { points };
  }

  /** The in-progress freeform path while dragging out a new lasso selection - an open polyline, unlike
   *  the closed polygon selectionLassoOutline draws once released. */
  lassoDraftOutline(): { points: string } | null {
    if (!this.lassoDraftPoints || this.lassoDraftPoints.length < 2) return null;
    const cellPx = this.effectiveCellPx();
    return { points: this.lassoDraftPoints.map((p) => `${(p.x + 0.5) * cellPx},${(p.y + 0.5) * cellPx}`).join(' ') };
  }

  /** Starts a resize drag - called from a DOM resize handle's own pointerdown (see
   *  PixelSelectionOverlay.tsx) instead of hit-testing the canvas, so the handle works wherever it's
   *  actually drawn, including outside the canvas's own bounds. */
  startResizeDrag(handle: HandleName): void {
    if (this.tool !== 'select' || !this.selection) return;
    if (this.painting) this.resetGestureState();
    this.pushUndo();
    this.painting = true;
    this.resizeHandle = handle;
    this.resizeOrigin = { ...this.selection };
    this.resizeSource = this.captureSelectionPixels(this.selection);
    this.clearFrameRegion(this.selection);
    this.resizePreview = this.buildResizePreview(this.resizeSource, this.resizeOrigin, this.selection);
    this.cacheGestureBaseBitmap();
    this.refresh();
  }

  /** Continues an in-progress resize drag - called from the DOM handle's own pointermove (pointer
   *  capture routes the event there regardless of where the cursor visually is). Unclamped, so the
   *  box can be stretched fully outside the canvas rather than stopping dead at its edge. */
  updateResizeDrag(e: { clientX: number; clientY: number }): void {
    if (!this.resizeHandle || !this.resizeOrigin || !this.resizeSource) return;
    const c = this.cellFromEventUnclamped(e);
    const box = this.computeResizedBox(this.resizeOrigin, this.resizeHandle, c);
    this.selection = box;
    this.resizePreview = this.buildResizePreview(this.resizeSource, this.resizeOrigin, box);
    this.refresh();
  }

  /** Commits an in-progress resize drag - called from the DOM handle's own pointerup/pointercancel. */
  endResizeDrag(): void {
    if (!this.resizeHandle) return;
    this.painting = false;
    this.stopSprayTimer();
    this.commitResize();
    this.refresh();
  }

  /** Starts a rotate drag - called from the DOM rotate handle's own pointerdown (see
   *  PixelSelectionOverlay.tsx) instead of hit-testing the canvas, so the handle works wherever it's
   *  actually drawn, including outside the canvas's own bounds. */
  startRotateDrag(e: { clientX: number; clientY: number }): void {
    if (!SELECTION_TOOLS.has(this.tool) || !this.selection) return;
    if (this.painting) this.resetGestureState();
    this.pushUndo();
    this.painting = true;
    this.rotateOrigin = { ...this.selection };
    this.rotateSource = this.captureSelectionPixels(this.selection);
    this.clearFrameRegion(this.selection);
    const pt = this.pxFromEvent(e);
    if (!pt) return;
    const cellPx = this.effectiveCellPx();
    const { cx, cy } = this.selectionCenterPx(this.rotateOrigin, cellPx);
    this.rotateStartAngle = Math.atan2(pt.py - cy, pt.px - cx);
    this.rotateAngle = 0;
    const { cells, box } = this.computeRotatePreview(0);
    this.rotatePreview = cells;
    this.selection = box;
    this.cacheGestureBaseBitmap();
    this.refresh();
  }

  /** Continues an in-progress rotate drag - called from the DOM handle's own pointermove (pointer
   *  capture routes the event there regardless of where the cursor visually is). */
  updateRotateDrag(e: { clientX: number; clientY: number }): void {
    if (!this.rotateOrigin || !this.rotateSource) return;
    const pt = this.pxFromEvent(e);
    if (!pt) return;
    const cellPx = this.effectiveCellPx();
    const { cx, cy } = this.selectionCenterPx(this.rotateOrigin, cellPx);
    const currentAngle = Math.atan2(pt.py - cy, pt.px - cx);
    this.rotateAngle = currentAngle - this.rotateStartAngle;
    const { cells, box } = this.computeRotatePreview(this.rotateAngle);
    this.rotatePreview = cells;
    this.selection = box;
    // Unlike the resize-drag branch's plain drawGrid() (canvas-only, nothing else depends on it),
    // the DOM rotate handle (PixelSelectionOverlay.tsx) reads selectionRotateHandle() on every React
    // render - without reactNotify() here it would freeze at its pre-drag position for the whole
    // gesture and only snap to the right spot once refresh() fires on release.
    this.refresh();
  }

  /** Commits an in-progress rotate drag - called from the DOM handle's own pointerup/pointercancel. */
  endRotateDrag(): void {
    if (!this.rotateOrigin) return;
    this.painting = false;
    this.stopSprayTimer();
    this.commitRotate();
    this.refresh();
  }

  onPointerDown(e: React.PointerEvent<HTMLCanvasElement>): void {
    // Middle-button pan (Paint/Photoshop/Pixilart convention): works regardless of the active tool and
    // independent of `painting`/tool-specific state entirely, so it can't trigger a draw action and
    // doesn't care what a concurrent primary-button gesture is doing. preventDefault suppresses the
    // browser's own middle-click autoscroll mode, which would otherwise also arm on this same event.
    if (e.button === 1) {
      e.preventDefault();
      this.middlePanActive = true;
      this.middlePanLast = { x: e.clientX, y: e.clientY };
      this.canvas?.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button === 2 && !ERASABLE_TOOLS.has(this.tool)) return;

    const cell = this.cellFromEvent(e);
    if (!cell) return;
    if (this.painting) this.resetGestureState();
    this.canvas?.setPointerCapture(e.pointerId);

    if (this.tool === 'eyedropper') {
      this.pickColor(cell.x, cell.y);
      return;
    }

    if (e.altKey && ALT_PICK_TOOLS.has(this.tool)) {
      this.pickColor(cell.x, cell.y, false);
      return;
    }

    if (this.tool === 'select') {
      if (this.isInsideSelection(cell)) {
        this.startMoveGesture(cell);
        return;
      }
      this.painting = true;
      this.selectStart = cell;
      this.selectionDraft = { x0: cell.x, y0: cell.y, x1: cell.x, y1: cell.y };
      // reactNotify(), not refresh() - a marquee-in-progress is pure metadata (see onPointerMove's
      // same substitution for the reasoning); starting one doesn't touch a single pixel either.
      this.reactNotify();
      return;
    }

    if (this.tool === 'lasso') {
      if (this.isInsideSelection(cell)) {
        this.startMoveGesture(cell);
        return;
      }
      this.painting = true;
      this.lassoDraftPoints = [cell];
      this.reactNotify();
      return;
    }

    if (this.tool === 'move') {
      this.startMoveGesture(cell);
      return;
    }

    if (this.tool === 'curve') {
      this.eraseOverride = e.button === 2;
      if (this.curvePhase === 'bend') {
        if (!this.isNearCurveControl(e)) {
          this.commitCurve();
          return;
        }
        this.painting = true;
        this.curveDraggingControl = true;
        this.curveControl = cell;
        this.redrawShapePreview(this.mirroredExpand(this.quadraticBezierCells(this.curveStart!, this.curveControl, this.curveEnd!)));
        return;
      }
      this.pushUndo();
      this.painting = true;
      this.curveStart = cell;
      this.curveEnd = cell;
      this.curveControl = null;
      this.curvePhase = 'drag-end';
      this.redrawShapePreview(this.mirroredExpand([cell]));
      return;
    }

    this.pushUndo();
    this.painting = true;
    this.eraseOverride = e.button === 2;

    if (this.tool === 'line' || this.tool === 'rect' || this.tool === 'ellipse') {
      this.shapeStart = cell;
      const end = e.shiftKey ? this.constrainShapeEnd(cell, cell) : cell;
      this.redrawShapePreview(this.mirroredExpand(this.computeShapeCells(cell, end)));
    } else if (this.tool === 'fill') {
      const frame = this.activeCells();
      const { width, height } = this.current;
      const fillColor = this.eraseOverride ? null : this.color;
      this.mirrorCells(cell.x, cell.y).forEach((m) => {
        this.floodFill(frame, width, height, m.x, m.y, frame[m.y * width + m.x], fillColor);
      });
      if (fillColor) this.addSavedColor(fillColor);
      this.refresh();
    } else if (this.tool === 'spray') {
      this.sprayPointerCell = cell;
      this.sprayTick();
      this.startSprayTimer();
    } else if (this.tool === 'gradient') {
      this.gradientStart = cell;
      this.gradientEnd = cell;
      this.drawGradientPreviewOverlay();
    } else {
      this.lastPaintCell = null;
      this.beginStroke();
      this.paintCell(cell.x, cell.y);
    }
  }

  onPointerMove(e: React.PointerEvent<HTMLCanvasElement>): void {
    if (this.middlePanActive) {
      if (!this.middlePanLast) return;
      const dx = e.clientX - this.middlePanLast.x;
      const dy = e.clientY - this.middlePanLast.y;
      this.middlePanLast = { x: e.clientX, y: e.clientY };
      const wrap = this.canvas?.parentElement?.parentElement as HTMLElement | null;
      if (wrap) {
        wrap.scrollLeft -= dx;
        wrap.scrollTop -= dy;
      }
      return;
    }
    if (!this.painting) {
      // The rotate handle and resize handles are DOM elements now (see PixelSelectionOverlay.tsx)
      // with their own CSS cursors, so there's nothing to hover-test for them here - only the
      // move-body, which still lives on this canvas.
      if (SELECTION_AWARE_TOOLS.has(this.tool) && this.selection && this.canvas) {
        const hoverCell = this.cellFromEvent(e);
        this.canvas.style.cursor = hoverCell && this.isInsideSelection(hoverCell) ? 'move' : '';
      }
      return;
    }

    if (this.moveBuffer) {
      if (!this.moveStartCell) return;
      // Unclamped - lets the selection be dragged fully outside the canvas, Paint-style, instead
      // of freezing in place the moment the pointer crosses the canvas edge.
      const uc = this.cellFromEventUnclamped(e);
      this.moveDelta = { dx: uc.x - this.moveStartCell.x, dy: uc.y - this.moveStartCell.y };
      // refresh(), not drawGrid() - the DOM rotate handle (PixelSelectionOverlay.tsx) reads
      // selectionRotateHandle(), which now tracks this move via moveDelta, but only on a React
      // re-render (reactNotify()); without it the handle would freeze at its pre-drag position for
      // the whole move gesture, same bug as the rotate-drag case this mirrors.
      this.refresh();
      return;
    }

    const cell = this.cellFromEvent(e);

    if (this.tool === 'select') {
      if (!cell || !this.selectStart) return;
      this.selectionDraft = normalizeBox(this.selectStart, cell);
      // reactNotify(), not refresh() - the marquee border is a DOM element now (PixelSelectionOverlay.tsx
      // reads selectionDraft directly), so this only needs a React re-render to track the drag live, same
      // as the settled-selection border/handles already do - dragging out a marquee never touches a pixel,
      // so the full clear+repaint refresh() would otherwise do here is pure waste, and on a large canvas
      // (e.g. a 1400x900 background) was the same kind of per-move stutter as an unbounded shape preview.
      this.reactNotify();
      return;
    }

    if (this.tool === 'lasso') {
      if (!cell || !this.lassoDraftPoints) return;
      const last = this.lassoDraftPoints[this.lassoDraftPoints.length - 1];
      if (!last || last.x !== cell.x || last.y !== cell.y) this.lassoDraftPoints.push(cell);
      // reactNotify(), not refresh() - the in-progress path is a DOM <polyline> (PixelSelectionOverlay.tsx
      // reads lassoDraftOutline directly), same reasoning as the marquee draft above.
      this.reactNotify();
      return;
    }

    if (this.tool === 'curve') {
      if (!cell) return;
      if (this.curvePhase === 'drag-end') {
        this.curveEnd = cell;
        this.redrawShapePreview(this.mirroredExpand(bresenhamLine(this.curveStart!.x, this.curveStart!.y, cell.x, cell.y)));
      } else if (this.curveDraggingControl) {
        this.curveControl = cell;
        this.redrawShapePreview(this.mirroredExpand(this.quadraticBezierCells(this.curveStart!, this.curveControl, this.curveEnd!)));
        // redrawShapePreview() always reactNotify()s, which the curve control handle - a DOM element
        // (PixelSelectionOverlay.tsx reads curveControl directly) - needs to track this drag live.
      }
      return;
    }

    if (this.tool === 'spray') {
      if (!cell) return;
      this.sprayPointerCell = cell;
      this.sprayTick();
      return;
    }

    if (this.tool === 'gradient') {
      if (!cell || !this.gradientStart) return;
      this.gradientEnd = e.shiftKey ? this.constrainShapeEnd(this.gradientStart, cell) : cell;
      this.drawGradientPreviewOverlay();
      return;
    }

    if (!cell) return;
    if (this.shapeStart) {
      const end = e.shiftKey ? this.constrainShapeEnd(this.shapeStart, cell) : cell;
      this.redrawShapePreview(this.mirroredExpand(this.computeShapeCells(this.shapeStart, end)));
    } else if (this.tool === 'pen' || this.tool === 'eraser') {
      this.paintCell(cell.x, cell.y, true);
    }
  }

  onPointerUp(): void {
    if (this.middlePanActive) {
      this.middlePanActive = false;
      this.middlePanLast = null;
      return;
    }
    if (!this.painting) return;
    this.painting = false;
    this.stopSprayTimer();

    if (this.moveBuffer) {
      this.commitMove();
      return;
    }

    if (this.tool === 'curve') {
      if (this.curvePhase === 'drag-end') {
        if (this.curveStart && this.curveEnd && (this.curveStart.x !== this.curveEnd.x || this.curveStart.y !== this.curveEnd.y)) {
          this.curveControl = {
            x: Math.round((this.curveStart.x + this.curveEnd.x) / 2),
            y: Math.round((this.curveStart.y + this.curveEnd.y) / 2),
          };
          this.curvePhase = 'bend';
          this.redrawShapePreview(this.mirroredExpand(this.quadraticBezierCells(this.curveStart, this.curveControl, this.curveEnd)));
          // The curve control handle (a DOM element - see PixelSelectionOverlay.tsx) first appears
          // right here, on the drag-end→bend transition - redrawShapePreview()'s reactNotify() is
          // what makes it actually show up.
        } else {
          this.cancelCurve();
        }
      } else if (this.curveDraggingControl) {
        this.curveDraggingControl = false;
        this.refresh();
      }
      return;
    }

    if (this.tool === 'select') {
      const d = this.selectionDraft;
      this.selection = d && (d.x0 !== d.x1 || d.y0 !== d.y1) ? d : null;
      this.lassoPoints = null;
      this.selectionMask = null;
      this.selectStart = null;
      this.selectionDraft = null;
      // reactNotify(), not refresh() - settling a selection is still pure metadata (see
      // onPointerMove's marquee-drag substitution above); the settled border/handles it now switches
      // to are DOM too (PixelSelectionOverlay.tsx's `box`, from selectionOverlayBox()).
      this.reactNotify();
      return;
    }

    if (this.tool === 'lasso') {
      const pts = this.lassoDraftPoints;
      this.lassoDraftPoints = null;
      const mask = pts && pts.length >= 3 ? this.polygonMask(pts) : null;
      if (pts && mask && mask.size > 0) {
        this.selection = this.boundingBoxOfPoints(pts);
        this.lassoPoints = pts;
        this.selectionMask = mask;
      } else {
        this.selection = null;
        this.lassoPoints = null;
        this.selectionMask = null;
      }
      this.reactNotify();
      return;
    }

    if (this.tool === 'gradient') {
      // The exact per-cell color array (gradientCellsPreview) is only computed here, once, on commit -
      // the live drag preview draws with the canvas's own native gradient instead (see
      // drawGradientPreviewOverlay) and never needs the per-cell array at all. Baking it into the
      // actual layer here, then - like the shape commit just below - what's left is a proper (z-order/
      // opacity-respecting) repaint of just the cells it covered, not the whole canvas.
      const preview = this.gradientStart && this.gradientEnd ? this.gradientCellsPreview(this.gradientStart, this.gradientEnd) : null;
      const rects = preview ? this.cellsDirtyRects(preview, null) : [];
      if (preview) {
        const frame = this.activeCells();
        const { width, height } = this.current;
        preview.forEach((c) => {
          if (c.x >= 0 && c.y >= 0 && c.x < width && c.y < height) frame[c.y * width + c.x] = c.color;
        });
        this.addSavedColor(this.color);
        this.addSavedColor(this.gradientColor);
      }
      this.gradientStart = null;
      this.gradientEnd = null;
      this.gradientPreview = null;
      this.eraseOverride = false;
      if (rects.length) this.redrawRegions(rects);
      else this.reactNotify();
      return;
    }

    if (this.shapeStart && this.shapePreviewCells) {
      const frame = this.activeCells();
      const { width, height } = this.current;
      const shapeColor = this.eraseOverride ? null : this.color;
      // Bounding box of the outgoing preview cells only ("erase old, draw nothing new") - by the time
      // this repaints, `frame` already has the committed colors, so there's no separate overlay left
      // to draw on top (unlike redrawShapePreview mid-drag); this just needs a proper, z-order/opacity-
      // respecting repaint of the region the (fillRect-approximated) live preview covered.
      const rects = this.cellsDirtyRects(this.shapePreviewCells, null);
      this.shapePreviewCells.forEach((c) => {
        if (c.x >= 0 && c.y >= 0 && c.x < width && c.y < height) frame[c.y * width + c.x] = shapeColor;
      });
      if (shapeColor) this.addSavedColor(shapeColor);
      this.shapeStart = null;
      this.shapePreviewCells = null;
      this.lastPaintCell = null;
      this.strokeSnapshot = null;
      this.strokePoints = [];
      this.eraseOverride = false;
      this.redrawRegions(rects);
      return;
    }
    // Pen/eraser/spray/fill all already left the canvas correctly painted (their own dirty-rect or
    // full-repaint redraw already ran on the last stroke step / on mousedown) - nothing here changes a
    // pixel, so this only needs a React re-render (e.g. for canUndo()/dirty-flag-driven UI), not another
    // full drawGrid().
    this.lastPaintCell = null;
    this.strokeSnapshot = null;
    this.strokePoints = [];
    this.eraseOverride = false;
    this.reactNotify();
  }

  /** Shift-constrain: line snaps to 0/45/90° increments, rect/ellipse snaps to a square/circle bounding box. */
  private constrainShapeEnd(start: Cell, end: Cell): Cell {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (dx === 0 && dy === 0) return end;
    if (this.tool === 'line' || this.tool === 'gradient') {
      const step = Math.PI / 4;
      const angle = Math.round(Math.atan2(dy, dx) / step) * step;
      const dist = Math.round(Math.hypot(dx, dy));
      return {
        x: start.x + Math.round(Math.cos(angle) * dist),
        y: start.y + Math.round(Math.sin(angle) * dist),
      };
    }
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    return {
      x: start.x + (dx < 0 ? -side : side),
      y: start.y + (dy < 0 ? -side : side),
    };
  }

  /** Thickens a 1px path (e.g. a Bresenham line) to `brushSize` by stamping brushCellsAt at every
   *  point and deduping - the same footprint a pencil stroke along that path would leave. Dedup isn't
   *  just tidiness: without it, a long path at a large brush size would emit path-length x brushSize^2
   *  cells (mostly overlapping squares), which is exactly the kind of unbounded-with-drag-distance cost
   *  redrawShapePreview's dirty-rect fix was meant to avoid. */
  private thickenPath(points: Cell[]): Cell[] {
    if (this.brushSize <= 1) return points;
    const seen = new Set<string>();
    const cells: Cell[] = [];
    points.forEach((p) => {
      this.brushCellsAt(p.x, p.y).forEach((c) => {
        const key = `${c.x},${c.y}`;
        if (!seen.has(key)) {
          seen.add(key);
          cells.push(c);
        }
      });
    });
    return cells;
  }

  private computeShapeCells(start: Cell, end: Cell): Cell[] {
    if (this.tool === 'line') {
      return this.thickenPath(bresenhamLine(start.x, start.y, end.x, end.y));
    }
    if (this.tool === 'rect') {
      const x0 = Math.min(start.x, end.x);
      const x1 = Math.max(start.x, end.x);
      const y0 = Math.min(start.y, end.y);
      const y1 = Math.max(start.y, end.y);
      const thickness = this.brushSize;
      const cells: Cell[] = [];
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const nearEdge = x - x0 < thickness || x1 - x < thickness || y - y0 < thickness || y1 - y < thickness;
          if (this.shapeFilled || nearEdge) cells.push({ x, y });
        }
      }
      return cells;
    }
    // ellipse
    const x0 = Math.min(start.x, end.x);
    const x1 = Math.max(start.x, end.x);
    const y0 = Math.min(start.y, end.y);
    const y1 = Math.max(start.y, end.y);
    const cx = (x0 + x1) / 2 + 0.5;
    const cy = (y0 + y1) / 2 + 0.5;
    const rx = Math.max(0.5, (x1 - x0 + 1) / 2);
    const ry = Math.max(0.5, (y1 - y0 + 1) / 2);
    const cells: Cell[] = [];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!inEllipseLocal(x + 0.5, y + 0.5, cx, cy, rx, ry)) continue;
        if (this.shapeFilled) {
          cells.push({ x, y });
          continue;
        }
        if (!inEllipseLocal(x + 0.5, y + 0.5, cx, cy, Math.max(0.5, rx - this.brushSize), Math.max(0.5, ry - this.brushSize))) cells.push({ x, y });
      }
    }
    return cells;
  }

  /** Samples a quadratic bezier through p0/p1/p2 and connects the samples with bresenham lines so the
   *  curve has no gaps, then thickens the result to `brushSize` the same way a line does (see
   *  thickenPath) - curve is its own code path from computeShapeCells (line/rect/ellipse), so it needed
   *  the same treatment applied separately rather than automatically inheriting it. */
  private quadraticBezierCells(p0: Cell, p1: Cell, p2: Cell): Cell[] {
    const approxLen = Math.hypot(p1.x - p0.x, p1.y - p0.y) + Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const steps = Math.max(8, Math.ceil(approxLen * 2));
    const cells: Cell[] = [];
    let prev: Cell | null = null;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const mt = 1 - t;
      const cell = {
        x: Math.round(mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x),
        y: Math.round(mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y),
      };
      if (prev) bresenhamLine(prev.x, prev.y, cell.x, cell.y).forEach((c) => cells.push(c));
      else cells.push(cell);
      prev = cell;
    }
    const seen = new Set<string>();
    const path = cells.filter((c) => {
      const key = `${c.x},${c.y}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return this.thickenPath(path);
  }

  /**
   * Blends startColor -> endColor across the selection (or the whole canvas with none) along the
   * start/end axis: each cell's position is projected onto that axis and clamped to [0,1]. A
   * right-click reverses which color sits at which end, reusing eraseOverride as a swap flag.
   */
  private gradientCellsPreview(start: Cell, end: Cell): MoveBufferCell[] {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lenSq = dx * dx + dy * dy;
    const box = this.selection ?? { x0: 0, y0: 0, x1: this.current.width - 1, y1: this.current.height - 1 };
    const startColor = this.eraseOverride ? this.gradientColor : this.color;
    const endColor = this.eraseOverride ? this.color : this.gradientColor;
    const [sr, sg, sb] = hexToRgb(startColor);
    const [er, eg, eb] = hexToRgb(endColor);
    const out: MoveBufferCell[] = [];
    for (let y = box.y0; y <= box.y1; y++) {
      for (let x = box.x0; x <= box.x1; x++) {
        let t = 0.5;
        if (lenSq > 0) {
          t = ((x + 0.5 - start.x) * dx + (y + 0.5 - start.y) * dy) / lenSq;
          t = Math.min(1, Math.max(0, t));
        }
        const color = rgbToHex(sr + (er - sr) * t, sg + (eg - sg) * t, sb + (eb - sb) * t);
        out.push({ x, y, color });
      }
    }
    return out;
  }

  /**
   * Live drag preview for the gradient tool: paints the box directly with the canvas's own native
   * (GPU-composited) linear gradient instead of computing a per-cell color array and painting it cell by
   * cell every frame (see gradientCellsPreview, still used - but only once, on commit, see onPointerUp).
   * Profiling a drag on a 1400x900, 3-layer canvas found the old per-move path cost ~2440ms in drawGrid's
   * full repaint plus ~170ms recomputing the per-cell array - the worst of any tool in this file, and for
   * a reason specific to gradients: unlike a shape outline, a gradient fills its *entire* box every
   * frame, so the fillRect-per-cell overlay pass could never reuse paintFrameCells' run-length merging
   * (every cell has a different color) the way a scoped repaint could for other tools.
   *
   * This sidesteps that instead of optimizing it: the box is identical on every frame of one gradient
   * drag (the selection, or the whole canvas - never resized mid-drag), and the gradient is fully opaque,
   * so painting the new one straight over the previous frame's correctly replaces it without first
   * re-clearing or repainting the layers underneath - those only need painting once, whenever the drag
   * *starts* (already true: the canvas already shows the correct base picture at that point, so
   * onPointerDown doesn't need an extra repaint either, just this call). ctx.createLinearGradient handles
   * the same clamp-to-end-stop behavior as gradientCellsPreview's `Math.min(1, Math.max(0, t))` for
   * points beyond the start/end axis natively - the one case it doesn't match is a zero-length axis
   * (start === end, e.g. right on mousedown before any drag), which paints nothing at all rather than a
   * solid color, so that case is special-cased to match gradientCellsPreview's own `t = 0.5` default.
   */
  private drawGradientPreviewOverlay(): void {
    if (!this.ctx || !this.gradientStart || !this.gradientEnd) return;
    const box = this.selection ?? { x0: 0, y0: 0, x1: this.current.width - 1, y1: this.current.height - 1 };
    const startColor = this.eraseOverride ? this.gradientColor : this.color;
    const endColor = this.eraseOverride ? this.color : this.gradientColor;
    const w = box.x1 - box.x0 + 1;
    const h = box.y1 - box.y0 + 1;
    if (w <= 0 || h <= 0) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x0, box.y0, w, h);
    ctx.clip();
    const dx = this.gradientEnd.x - this.gradientStart.x;
    const dy = this.gradientEnd.y - this.gradientStart.y;
    if (dx === 0 && dy === 0) {
      const [sr, sg, sb] = hexToRgb(startColor);
      const [er, eg, eb] = hexToRgb(endColor);
      ctx.fillStyle = rgbToHex((sr + er) / 2, (sg + eg) / 2, (sb + eb) / 2);
    } else {
      const gradient = ctx.createLinearGradient(
        this.gradientStart.x + 0.5,
        this.gradientStart.y + 0.5,
        this.gradientEnd.x + 0.5,
        this.gradientEnd.y + 0.5
      );
      gradient.addColorStop(0, startColor);
      gradient.addColorStop(1, endColor);
      ctx.fillStyle = gradient;
    }
    ctx.fillRect(box.x0, box.y0, w, h);
    ctx.restore();
    this.reactNotify();
  }

  /** Silently drops any pending curve without a refresh - for use inside other state-resetting methods that will refresh themselves. */
  private clearCurveState(): void {
    this.curveStart = null;
    this.curveEnd = null;
    this.curveControl = null;
    this.curvePhase = null;
    this.curveDraggingControl = false;
    this.shapePreviewCells = null;
  }

  private cancelCurve(): void {
    this.clearCurveState();
    this.eraseOverride = false;
    this.refresh();
  }

  private commitCurve(): void {
    if (this.curveStart && this.curveEnd && this.curveControl && this.shapePreviewCells) {
      const frame = this.activeCells();
      const { width, height } = this.current;
      const color = this.eraseOverride ? null : this.color;
      this.shapePreviewCells.forEach((c) => {
        if (c.x >= 0 && c.y >= 0 && c.x < width && c.y < height) frame[c.y * width + c.x] = color;
      });
      if (color) this.addSavedColor(color);
    }
    this.painting = false;
    this.cancelCurve();
  }

  private startSprayTimer(): void {
    if (this.sprayTimer) clearInterval(this.sprayTimer);
    this.sprayTimer = setInterval(() => this.sprayTick(), SPRAY_INTERVAL_MS);
  }

  private stopSprayTimer(): void {
    if (this.sprayTimer) {
      clearInterval(this.sprayTimer);
      this.sprayTimer = null;
    }
    this.sprayPointerCell = null;
  }

  /** Scatters a handful of random dots within the brush-size radius around the last known pointer cell. */
  private sprayTick(): void {
    if (!this.sprayPointerCell) return;
    const { width, height } = this.current;
    const frame = this.activeCells();
    const color = this.currentPaintColor();
    const radius = this.brushSize + 1;
    const dots = radius;
    for (let i = 0; i < dots; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;
      const x = Math.round(this.sprayPointerCell.x + Math.cos(angle) * r);
      const y = Math.round(this.sprayPointerCell.y + Math.sin(angle) * r);
      this.mirrorCells(x, y).forEach((m) => {
        if (m.x >= 0 && m.y >= 0 && m.x < width && m.y < height) frame[m.y * width + m.x] = color;
      });
    }
    if (color) this.addSavedColor(color);
    this.refresh();
  }

  private mirrorCells(x: number, y: number): Cell[] {
    const { width, height } = this.current;
    const pts: Cell[] = [{ x, y }];
    const mirrorX = width - 1 - x;
    const mirrorY = height - 1 - y;
    if (this.symmetry === 'vertical' || this.symmetry === 'both') pts.push({ x: mirrorX, y });
    if (this.symmetry === 'horizontal' || this.symmetry === 'both') pts.push({ x, y: mirrorY });
    if (this.symmetry === 'both') pts.push({ x: mirrorX, y: mirrorY });
    return pts;
  }

  private mirroredExpand(cells: Cell[]): Cell[] {
    if (this.symmetry === 'none') return cells;
    const seen = new Set<string>();
    const out: Cell[] = [];
    cells.forEach((c) => {
      this.mirrorCells(c.x, c.y).forEach((m) => {
        const key = `${m.x},${m.y}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push(m);
        }
      });
    });
    return out;
  }

  private currentPaintColor(): string | null {
    return this.tool === 'eraser' || this.eraseOverride ? null : this.color;
  }

  /** Top-left-anchored square of side `brushSize` centered as closely as possible on (x, y). */
  private brushCellsAt(x: number, y: number): Cell[] {
    if (this.brushSize <= 1) return [{ x, y }];
    const off = Math.floor((this.brushSize - 1) / 2);
    const cells: Cell[] = [];
    for (let dy = 0; dy < this.brushSize; dy++) {
      for (let dx = 0; dx < this.brushSize; dx++) {
        cells.push({ x: x - off + dx, y: y - off + dy });
      }
    }
    return cells;
  }

  private applyBrushAt(x: number, y: number, color: string | null): void {
    const { width, height } = this.current;
    const frame = this.activeCells();
    this.brushCellsAt(x, y).forEach((cell) => {
      this.mirrorCells(cell.x, cell.y).forEach((m) => {
        if (m.x >= 0 && m.y >= 0 && m.x < width && m.y < height) frame[m.y * width + m.x] = color;
      });
    });
  }

  /** Starts a new freehand stroke: snapshots the layer so Pixel Perfect can restore a trimmed corner pixel. */
  private beginStroke(): void {
    this.strokeSnapshot = this.activeCells().slice();
    this.strokePoints = [];
  }

  private restoreCellFromSnapshot(x: number, y: number): void {
    const { width, height } = this.current;
    if (!this.strokeSnapshot || x < 0 || y < 0 || x >= width || y >= height) return;
    const idx = y * width + x;
    this.activeCells()[idx] = this.strokeSnapshot[idx];
  }

  /**
   * Aseprite-style Pixel Perfect: when a freehand stroke turns a corner (three points where the
   * first and third are diagonal neighbors and the middle one is the right-angle corner between
   * them), the corner pixel is redundant for connectivity and just thickens the stroke - so it's
   * un-painted, keeping a clean 1px staircase instead of a doubled corner.
   */
  private applyPixelPerfectCorner(): void {
    const n = this.strokePoints.length;
    if (n < 3) return;
    const a = this.strokePoints[n - 3];
    const b = this.strokePoints[n - 2];
    const c = this.strokePoints[n - 1];
    if (Math.abs(c.x - a.x) !== 1 || Math.abs(c.y - a.y) !== 1) return;
    const isCorner = (b.x === a.x && b.y === c.y) || (b.x === c.x && b.y === a.y);
    if (!isCorner) return;
    this.mirrorCells(b.x, b.y).forEach((m) => this.restoreCellFromSnapshot(m.x, m.y));
    this.strokePoints.splice(n - 2, 1);
  }

  private strokeStep(x: number, y: number): void {
    const color = this.currentPaintColor();
    this.applyBrushAt(x, y, color);
    if (this.brushSize === 1) {
      const last = this.strokePoints[this.strokePoints.length - 1];
      if (!last || last.x !== x || last.y !== y) {
        this.strokePoints.push({ x, y });
        this.applyPixelPerfectCorner();
      }
    }
    this.lastPaintCell = { x, y };
    if (color) this.addSavedColor(color);
  }

  /**
   * Bounding box(es), in canvas cell coords, that a freehand stroke through `points` actually touches
   * at the current brush size - what paintCell redraws instead of the whole canvas (see redrawRegions).
   * Padded by 1 cell beyond the brush footprint to also cover strokeStep's Pixel-Perfect corner trim,
   * which can retroactively un-paint a cell up to 1 cell outside the current point's own footprint.
   * Symmetry adds one more rect per mirror axis (mirroring a rectangle's bounds still gives a
   * rectangle), since applyBrushAt paints those mirrored cells too.
   */
  private strokeDirtyRects(points: Cell[]): SelectionBox[] {
    if (!points.length) return [];
    const { width, height } = this.current;
    const off = Math.floor((this.brushSize - 1) / 2);
    const pad = 1;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    points.forEach((p) => {
      x0 = Math.min(x0, p.x - off - pad);
      x1 = Math.max(x1, p.x - off + this.brushSize - 1 + pad);
      y0 = Math.min(y0, p.y - off - pad);
      y1 = Math.max(y1, p.y - off + this.brushSize - 1 + pad);
    });
    x0 = Math.max(0, x0);
    y0 = Math.max(0, y0);
    x1 = Math.min(width - 1, x1);
    y1 = Math.min(height - 1, y1);
    if (x1 < x0 || y1 < y0) return [];
    const rects: SelectionBox[] = [{ x0, y0, x1, y1 }];
    if (this.symmetry === 'vertical' || this.symmetry === 'both') {
      rects.push({ x0: width - 1 - x1, x1: width - 1 - x0, y0, y1 });
    }
    if (this.symmetry === 'horizontal' || this.symmetry === 'both') {
      rects.push({ x0, x1, y0: height - 1 - y1, y1: height - 1 - y0 });
    }
    if (this.symmetry === 'both') {
      rects.push({ x0: width - 1 - x1, x1: width - 1 - x0, y0: height - 1 - y1, y1: height - 1 - y0 });
    }
    return rects;
  }

  /**
   * Redraws only `rects` of the canvas instead of the whole thing, for paths where drawGrid()'s usual
   * full clear+repaint was the actual measured bottleneck on a large, detailed canvas: profiling a
   * 1400×900 canvas with content that defeats paintFrameCells' run-length merging (no long same-color
   * runs - a real, not contrived, case for detailed pixel art) measured a full redraw at ~590ms per
   * layer, so every pointer move during a stroke (see paintCell/strokeDirtyRects) or a shape/curve
   * preview (see cellsDirtyRects) was gated on hundreds of milliseconds of work regardless of how
   * small the actual change was. Both only ever touch a small, boundable area, so bounding the repaint
   * to just that area makes its cost depend on the edit size, not the canvas size - confirmed back down
   * to sub-millisecond on the same worst-case content (see the before/after profile in the commit/PR
   * notes for this change). Undo/redo (see applyHistoryEntry) reuses this too, for the same reason, with
   * the changed region found by diffing the two snapshots instead of tracked during the edit.
   *
   * `overlay` optionally draws a shape/curve preview's cells on top of the repainted regions, in the
   * given color - the same thing drawGrid()'s `overlayCells` param does, just scoped to `rects` instead
   * of a full repaint. Not used for gradient/move/resize/rotate previews, which keep calling refresh()'s
   * full drawGrid() unchanged - those already have their own optimization (gestureBaseBitmap) or aren't
   * worth the same treatment yet.
   */
  private redrawRegions(rects: SelectionBox[], overlay?: { cells: Cell[]; color: string }): void {
    if (!this.canvas || !this.ctx || !rects.length) return;
    const { width, height } = this.current;
    const ctx = this.ctx;
    rects.forEach((r) => {
      ctx.clearRect(r.x0, r.y0, r.x1 - r.x0 + 1, r.y1 - r.y0 + 1);
      if (this.onionSkin && this.current.frames.length > 1) {
        const prevIdx = (this.frameIndex - 1 + this.current.frames.length) % this.current.frames.length;
        paintLayers(ctx, this.current.frames[prevIdx], width, height, 1, 0.3, r);
      }
      paintLayers(ctx, this.current.frames[this.frameIndex], width, height, 1, 1, r);
    });
    if (overlay) {
      ctx.fillStyle = overlay.color;
      overlay.cells.forEach((c) => {
        if (c.x >= 0 && c.y >= 0 && c.x < width && c.y < height) ctx.fillRect(c.x, c.y, 1, 1);
      });
    }
    this.reactNotify();
  }

  /**
   * Union bounding box (canvas cell coords) of two cell sets - `null` for "none". Used both for a
   * shape/curve preview's own old-vs-new frame (see redrawShapePreview: "erase the old preview" only
   * ever needs to clear where it actually was, not the whole canvas, and the new preview is drawn on
   * top of that same repaint via redrawRegions' `overlay` param) and, with `null` as the second set,
   * to bound the one-time repaint a shape/gradient commit needs (see onPointerUp) to just the cells
   * that were previewed instead of the whole canvas.
   */
  private cellsDirtyRects(oldCells: Cell[] | null, newCells: Cell[] | null): SelectionBox[] {
    const { width, height } = this.current;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const consider = (cells: Cell[] | null) => {
      cells?.forEach((c) => {
        if (c.x < x0) x0 = c.x;
        if (c.x > x1) x1 = c.x;
        if (c.y < y0) y0 = c.y;
        if (c.y > y1) y1 = c.y;
      });
    };
    consider(oldCells);
    consider(newCells);
    if (x1 < x0 || y1 < y0) return [];
    x0 = Math.max(0, x0);
    y0 = Math.max(0, y0);
    x1 = Math.min(width - 1, x1);
    y1 = Math.min(height - 1, y1);
    if (x1 < x0 || y1 < y0) return [];
    return [{ x0, y0, x1, y1 }];
  }

  /** Replaces shapePreviewCells with `newCells` and repaints only the union of its old and new bounding
   *  box (see cellsDirtyRects) instead of refresh()'s full drawGrid() - the redraw path for every
   *  line/rect/ellipse/curve preview frame while dragging. */
  private redrawShapePreview(newCells: Cell[] | null): void {
    const oldCells = this.shapePreviewCells;
    this.shapePreviewCells = newCells;
    const rects = this.cellsDirtyRects(oldCells, newCells);
    if (!rects.length) {
      this.reactNotify();
      return;
    }
    const color = this.eraseOverride ? 'rgba(255,255,255,0.45)' : this.color;
    this.redrawRegions(rects, newCells ? { cells: newCells, color } : undefined);
  }

  private paintCell(x: number, y: number, isMove?: boolean): void {
    const { width, height } = this.current;
    const inBounds = (px: number, py: number) => px >= 0 && py >= 0 && px < width && py < height;

    let points: Cell[];
    if (isMove && this.lastPaintCell) {
      points = bresenhamLine(this.lastPaintCell.x, this.lastPaintCell.y, x, y);
    } else if (inBounds(x, y)) {
      points = [{ x, y }];
    } else {
      points = [];
    }

    points.forEach((p) => {
      if (inBounds(p.x, p.y)) this.strokeStep(p.x, p.y);
    });

    this.redrawRegions(this.strokeDirtyRects(points));
  }

  /** Samples the topmost visible layer that has paint at this cell, matching what's on screen. */
  private pickColor(x: number, y: number, switchToPen = true): void {
    const width = this.current.width;
    const layers = this.layers();
    for (let i = layers.length - 1; i >= 0; i--) {
      if (!layers[i].visible) continue;
      const sampled = layers[i].cells[y * width + x];
      if (sampled) {
        this.color = sampled;
        if (switchToPen) this.tool = 'pen';
        this.reactNotify();
        return;
      }
    }
  }

  private floodFill(frame: Frame, width: number, height: number, x: number, y: number, target: string | null, fillColor: string | null): void {
    if (target === fillColor) return;
    // Packed 1D indices on a plain number[] stack, not [number, number] tuples - avoids allocating
    // a small array object per visited cell (up to width*height of them on a large canvas), which
    // mattered once a background-sized fill made this the dominant cost of the fill tool. Bounds are
    // checked before pushing (not after popping), so an out-of-range neighbor never round-trips
    // through the stack at all.
    const stack: number[] = [y * width + x];
    while (stack.length) {
      const idx = stack.pop()!;
      if (frame[idx] !== target) continue;
      frame[idx] = fillColor;
      const cx = idx % width;
      if (cx + 1 < width) stack.push(idx + 1);
      if (cx - 1 >= 0) stack.push(idx - 1);
      if (idx + width < width * height) stack.push(idx + width);
      if (idx - width >= 0) stack.push(idx - width);
    }
  }

  // --- rendering ---

  /** Composites layers at their native, unscaled 1px-per-cell resolution onto a reused off-screen
   *  canvas - used only by tickPreview() now (a small, fixed-size preview panel that isn't a hot
   *  path), which still needs a scale-up blit since its own canvas is a different, unrelated size
   *  from the sprite. The main editing canvas doesn't need this indirection any more: it's now
   *  native-resolution itself (see recomputeCanvasSize), so drawGrid() paints directly onto it. */
  private compositeToBitmap(layers: Layer[], width: number, height: number, alphaMultiplier = 1): HTMLCanvasElement {
    if (!this.spriteBitmap) this.spriteBitmap = document.createElement('canvas');
    const bmp = this.spriteBitmap;
    if (bmp.width !== width || bmp.height !== height) {
      bmp.width = width;
      bmp.height = height;
    }
    const bctx = bmp.getContext('2d')!;
    bctx.clearRect(0, 0, width, height);
    paintLayers(bctx, layers, width, height, 1, alphaMultiplier);
    return bmp;
  }

  /** Paints only the sprite content, at native 1px-per-cell resolution (this <canvas> is exactly
   *  width×height pixels - see recomputeCanvasSize). Grid lines, symmetry guides, the selection-draft
   *  marquee, and the curve control handle used to be drawn here too, but at native resolution
   *  there's no room to draw a hairline *between* cells or a fixed-size handle glyph - they're a DOM
   *  overlay now (PixelSelectionOverlay.tsx), which also means their live updates during a drag now
   *  need a reactNotify()/refresh() to reach that overlay - see the pointer handlers that touch
   *  selectionDraft/curveControl for where that was added. */
  drawGrid(overlayCells?: Cell[]): void {
    if (!this.canvas || !this.ctx) return;
    const { width, height } = this.current;
    const canvas = this.canvas;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (this.onionSkin && this.current.frames.length > 1) {
      const prevIdx = (this.frameIndex - 1 + this.current.frames.length) % this.current.frames.length;
      paintLayers(ctx, this.current.frames[prevIdx], width, height, 1, 0.3);
    }

    // During a move/resize/rotate drag, the base scene (everything but the dragged region, which is
    // drawn separately below at its live offset) hasn't changed since the gesture started - only its
    // on-screen position has - so it's blitted from gestureBaseBitmap with one drawImage() instead of
    // re-running paintLayers() over every layer on every single pointer move. That full repaint was the
    // actual cost that made dragging a selection on a large canvas (e.g. a 1400×900 background) lag.
    if ((this.moveBuffer || this.resizePreview || this.rotatePreview) && this.gestureBaseBitmap) {
      ctx.drawImage(this.gestureBaseBitmap, 0, 0);
    } else {
      paintLayers(ctx, this.current.frames[this.frameIndex], width, height, 1);
    }

    if (this.moveBuffer) {
      const { dx, dy } = this.moveDelta;
      this.moveBuffer.cells.forEach((c) => {
        const nx = c.x + dx;
        const ny = c.y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
        ctx.fillStyle = c.color;
        ctx.fillRect(nx, ny, 1, 1);
      });
    }

    if (this.resizePreview) {
      this.resizePreview.forEach((c) => {
        if (c.x < 0 || c.y < 0 || c.x >= width || c.y >= height) return;
        ctx.fillStyle = c.color;
        ctx.fillRect(c.x, c.y, 1, 1);
      });
    }

    if (this.rotatePreview) {
      this.rotatePreview.forEach((c) => {
        if (c.x < 0 || c.y < 0 || c.x >= width || c.y >= height) return;
        ctx.fillStyle = c.color;
        ctx.fillRect(c.x, c.y, 1, 1);
      });
    }

    if (this.gradientPreview) {
      this.gradientPreview.forEach((c) => {
        if (c.x < 0 || c.y < 0 || c.x >= width || c.y >= height) return;
        ctx.fillStyle = c.color;
        ctx.fillRect(c.x, c.y, 1, 1);
      });
    }

    if (overlayCells) {
      ctx.fillStyle = this.eraseOverride ? 'rgba(255,255,255,0.45)' : this.color;
      overlayCells.forEach((c) => {
        if (c.x < 0 || c.y < 0 || c.x >= width || c.y >= height) return;
        ctx.fillRect(c.x, c.y, 1, 1);
      });
    }
  }

  /**
   * Re-armed whenever the current sprite's frameMs changes, or a different sprite becomes current.
   * Renders once immediately (so the thumbnail reflects the new sprite right away instead of waiting
   * up to frameMs for the first tick) and only schedules repeat ticks when there's more than one frame
   * to animate between - a single-frame sprite's composited bitmap can never change, so ticking it
   * anyway was pure waste. That waste wasn't just cosmetic: tickPreview composites the sprite at full
   * resolution (see compositeToBitmap/paintLayers) regardless of the small 160x160 thumbnail it's drawn
   * into, so on a large single-frame 'background' sprite (up to 1400x900 - the common case, since a
   * background is rarely animated) each tick cost ~1750ms on a 3-layer checkerboard-content canvas -
   * longer than the default 350ms tick period itself, so the timer was re-firing back-to-back
   * essentially continuously, starving the main thread for as long as that sprite stayed open for
   * editing (independent of anything else this file does - discovered profiling shape preview/undo-redo
   * on exactly this kind of sprite, where it made even unrelated, otherwise-instant calls crawl).
   */
  private restartPreviewTimer(): void {
    if (this.previewTimer) clearInterval(this.previewTimer);
    this.previewTimer = null;
    this.tickPreview();
    if (this.current.frames.length > 1) {
      this.previewTimer = setInterval(() => this.tickPreview(), this.current.frameMs);
    }
  }

  setFrameSpeed(fps: number): void {
    const clampedFps = Math.min(storage.MAX_FRAME_FPS, Math.max(storage.MIN_FRAME_FPS, fps));
    const frameMs = Math.round(1000 / clampedFps);
    if (frameMs === this.current.frameMs) return;
    this.pushUndo();
    this.current.frameMs = frameMs;
    this.restartPreviewTimer();
    this.refresh();
  }

  private tickPreview(): void {
    if (!this.previewCanvas || !this.previewCtx) return;
    const frames = this.current.frames;
    this.previewFrame = (this.previewFrame + 1) % frames.length;
    const { width, height } = this.current;
    const cellPx = PREVIEW_CELL_PX_BASE / Math.max(width, height);
    const ctx = this.previewCtx;
    ctx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
    ctx.imageSmoothingEnabled = false;
    const bmp = this.compositeToBitmap(frames[this.previewFrame], width, height);
    const dx = (this.previewCanvas.width - width * cellPx) / 2;
    const dy = (this.previewCanvas.height - height * cellPx) / 2;
    ctx.drawImage(bmp, 0, 0, width, height, dx, dy, width * cellPx, height * cellPx);
  }

  // --- undo/redo ---

  private snapshot(): Snapshot {
    return {
      // structuredClone, not JSON.parse(JSON.stringify(...)) - frames is plain data (no functions/
      // undefined), and the engine-native structured-clone algorithm skips JSON's string
      // serialize/parse round trip, which matters once a large (e.g. background-sized) canvas makes
      // this array huge and every stroke pushes a new undo snapshot.
      frames: structuredClone(this.current.frames),
      width: this.current.width,
      height: this.current.height,
      frameIndex: this.frameIndex,
      activeLayerIndex: this.activeLayerIndex,
      frameMs: this.current.frameMs,
    };
  }

  /** Mutates engine state to match snapshot `s` - the repaint is the caller's job (see
   *  applyHistoryEntry), since unlike every other refresh()-triggering change, undo/redo can often get
   *  away with repainting far less than the whole canvas. */
  private restoreSnapshot(s: Snapshot): void {
    this.current.frames = s.frames;
    this.current.width = s.width;
    this.current.height = s.height;
    this.current.frameMs = s.frameMs;
    this.frameIndex = Math.min(s.frameIndex, s.frames.length - 1);
    this.activeLayerIndex = Math.min(s.activeLayerIndex, this.current.frames[this.frameIndex].length - 1);
    this.selection = null;
    this.lassoPoints = null;
    this.selectionMask = null;
    this.moveBuffer = null;
    if (this.curvePhase) this.clearCurveState();
    this.recomputeCanvasSize();
    this.restartPreviewTimer();
  }

  pushUndo(): void {
    if (this.curvePhase) this.clearCurveState();
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.dirty = true;
  }

  /**
   * Undo/redo swap in a whole snapshotted frame stack, so - unlike a brush stroke or shape preview -
   * there's no dirty region known in advance the way strokeDirtyRects/cellsDirtyRects give one.
   * But most undo steps (undoing one small brush stroke on a large canvas) only actually change a tiny
   * fraction of it, so layersDiffRegion compares the outgoing and incoming layers cell-by-cell (plain
   * !== on color strings - far cheaper than the fillRect calls a repaint needs) to find the changed
   * region's bounding box, and redrawRegions repaints just that instead of a full drawGrid(). Falls back
   * to the ordinary full refresh() whenever the two states aren't safely comparable this way (different
   * canvas size, a different active frame index after restoring, or whatever else layersDiffRegion
   * itself declines to diff - e.g. a different layer count or a visibility/opacity change) or onion skin
   * is on (its own source frame would need the same treatment, not worth it for a rarely-used mode).
   */
  private applyHistoryEntry(s: Snapshot): void {
    const beforeLayers = this.current.frames[this.frameIndex];
    const beforeWidth = this.current.width;
    const beforeHeight = this.current.height;
    const beforeFrameIndex = this.frameIndex;

    this.restoreSnapshot(s);

    const canDiff =
      !this.onionSkin &&
      beforeWidth === this.current.width &&
      beforeHeight === this.current.height &&
      beforeFrameIndex === this.frameIndex;
    const region = canDiff ? layersDiffRegion(beforeLayers, this.current.frames[this.frameIndex], this.current.width, this.current.height) : 'full';

    if (region === null) this.reactNotify();
    else if (region === 'full') this.refresh();
    else this.redrawRegions([region]);
  }

  undo(): void {
    if (!this.undoStack.length) return;
    this.redoStack.push(this.snapshot());
    this.applyHistoryEntry(this.undoStack.pop()!);
  }

  redo(): void {
    if (!this.redoStack.length) return;
    this.undoStack.push(this.snapshot());
    this.applyHistoryEntry(this.redoStack.pop()!);
  }

  // --- export ---

  private downloadBlob(blob: Blob | null, filename: string): void {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  exportFramePng(): void {
    const { width, height } = this.current;
    const scale = Math.max(4, Math.round(256 / Math.max(width, height)));
    const off = document.createElement('canvas');
    off.width = width * scale;
    off.height = height * scale;
    const ctx = off.getContext('2d')!;
    paintLayers(ctx, this.current.frames[this.frameIndex], width, height, scale);
    const name = (this.current.name || 'sprite').trim() || 'sprite';
    off.toBlob((blob) => this.downloadBlob(blob, `${name}_frame${this.frameIndex + 1}.png`));
  }

  exportSpriteSheetPng(): void {
    const { width, height } = this.current;
    const scale = Math.max(4, Math.round(256 / Math.max(width, height)));
    const frames = this.current.frames;
    const off = document.createElement('canvas');
    off.width = width * scale * frames.length;
    off.height = height * scale;
    const octx = off.getContext('2d')!;
    frames.forEach((layers, i) => {
      octx.save();
      octx.translate(i * width * scale, 0);
      paintLayers(octx, layers, width, height, scale);
      octx.restore();
    });
    const name = (this.current.name || 'sprite').trim() || 'sprite';
    off.toBlob((blob) => this.downloadBlob(blob, `${name}_sheet.png`));
  }

  // --- sprite library ---

  newSprite(confirmDiscard: () => boolean): void {
    if (this.dirty && !confirmDiscard()) return;
    this.current = blankSprite();
    this.frameIndex = 0;
    this.activeLayerIndex = 0;
    this.selection = null;
    this.lassoPoints = null;
    this.selectionMask = null;
    this.moveBuffer = null;
    this.panX = 0;
    this.panY = 0;
    this.clearCurveState();
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
    this.loadToken += 1;
    this.recomputeCanvasSize();
    this.restartPreviewTimer();
    this.refresh();
  }

  saveCurrentSprite(name: string, type: Sprite['type'], onError: (msg: string) => void): void {
    const finalName =
      name.trim() ||
      (type === 'fish'
        ? t('sprite.defaultFishName')
        : type === 'room'
          ? t('sprite.defaultRoomName')
          : type === 'background'
            ? t('sprite.defaultBackgroundName')
            : t('sprite.defaultObjectName'));
    this.current.name = finalName;
    this.current.type = type;

    const previousSprites = this.sprites;
    if (this.current.id) {
      const idx = this.sprites.findIndex((s) => s.id === this.current.id);
      if (idx >= 0) this.sprites[idx] = cloneSprite(this.current);
    } else {
      this.current.id = storage.uid('sprite');
      this.sprites.push(cloneSprite(this.current));
    }

    try {
      storage.saveSprites(this.sprites);
    } catch (err) {
      console.error('saveSprites failed', err);
      this.sprites = previousSprites;
      onError(t('error.saveFailed'));
      return;
    }
    this.dirty = false;
    this.reactNotify();
    window.dispatchEvent(new CustomEvent('ft:sprites-updated'));
  }

  loadSpriteForEdit(sprite: Sprite, confirmDiscard: () => boolean): void {
    if (this.dirty && !confirmDiscard()) return;
    this.current = storage.normalizeSprite(cloneSprite(sprite));
    this.frameIndex = 0;
    this.activeLayerIndex = 0;
    this.previewFrame = 0;
    this.selection = null;
    this.lassoPoints = null;
    this.selectionMask = null;
    this.moveBuffer = null;
    this.panX = 0;
    this.panY = 0;
    this.clearCurveState();
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
    this.loadToken += 1;
    this.recomputeCanvasSize();
    this.restartPreviewTimer();
    this.refresh();
  }

  deleteSprite(id: string, confirmDelete: () => boolean, onError: (msg: string) => void): void {
    if (!confirmDelete()) return;
    const previousSprites = this.sprites;
    this.sprites = this.sprites.filter((s) => s.id !== id);
    try {
      storage.saveSprites(this.sprites);
    } catch (err) {
      console.error('saveSprites failed', err);
      this.sprites = previousSprites;
      onError(t('error.deleteFailed'));
      return;
    }
    if (this.current.id === id) {
      this.current = blankSprite();
      this.activeLayerIndex = 0;
      this.selection = null;
      this.lassoPoints = null;
      this.selectionMask = null;
      this.moveBuffer = null;
      this.panX = 0;
      this.panY = 0;
      this.clearCurveState();
      this.loadToken += 1;
      this.recomputeCanvasSize();
      this.restartPreviewTimer();
      this.refresh();
    } else {
      this.reactNotify();
    }
    window.dispatchEvent(new CustomEvent('ft:sprite-deleted', { detail: { id } }));
  }
}

export function usePixelEditor() {
  const engineRef = useRef<PixelEditorEngine | null>(null);
  const [, setTick] = useState(0);
  if (!engineRef.current) {
    engineRef.current = new PixelEditorEngine();
  }
  const engine = engineRef.current;

  useEffect(() => {
    engine.init(() => setTick((t) => t + 1));
    return () => engine.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return engine;
}

export type { PixelEditorEngine };
