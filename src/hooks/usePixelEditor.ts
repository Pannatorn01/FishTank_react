import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  ditherColorAt,
  ditherGradientMix,
  flipFrameH,
  flipFrameV,
  hexToRgb,
  layersDiffRegion,
  paintLayers,
  rgbToHex,
  rotateFrame,
  shiftBox,
  wrapShiftFrame,
} from '@/lib/pixelMath';
import { t } from '@/lib/i18n';
import {
  type HistoryEntry,
  type HistorySnapshot,
  NO_CHANGE,
  applyRegion,
  buildHistoryEntry,
  trimHistory,
} from '@/lib/undoHistory';
import * as storage from '@/lib/storage';
import { pixelateImageFile } from '@/lib/imageImport';
import { createPenTool } from '@/lib/tools/tools/penTool';
import { createShapeTool } from '@/lib/tools/tools/shapeTool';
import { createMagicWandTool, resolveWandCombine } from '@/lib/tools/tools/magicWandTool';
import { createMoveTool } from '@/lib/tools/tools/moveTool';
import { createSelectTool } from '@/lib/tools/tools/selectTool';
import { createLassoTool } from '@/lib/tools/tools/lassoTool';
import { createEyedropperTool } from '@/lib/tools/tools/eyedropperTool';
import { createFillTool } from '@/lib/tools/tools/fillTool';
import { createGradientTool, gradientT } from '@/lib/tools/tools/gradientTool';
import { createSprayTool } from '@/lib/tools/tools/sprayTool';
import { createCurveTool } from '@/lib/tools/tools/curveTool';
import { resolveMarqueeMode } from '@/lib/tools/selectionMask';
import type { Gesture, GestureResult, Tool, ToolContext, ToolPointerEvent, ToolPreview } from '@/lib/tools/types';
import type {
  CanvasBackground,
  Cell,
  Frame,
  GradientType,
  Layer,
  OnionColorMode,
  ResizeAnchor,
  ResizeMode,
  SelectionBox,
  SelectionMode,
  Sprite,
  SpriteType,
  SymmetryMode,
  ToolName,
} from '@/lib/types';

/** A couple of built-in underwater-themed preset palettes for the top palette row (see
 *  applyPresetPalette/ColorPalette.tsx) - a quick starting point distinct from a user's own saved
 *  colors, not persisted themselves (only the result of applying one, via paletteColors, is). */
export const PRESET_PALETTES: Record<string, string[]> = {
  reef: ['#04293a', '#064663', '#158fad', '#41c9e2', '#78e08f', '#f6b93b', '#e58e26', '#e55039', '#fad390', '#f8c291'],
  deepSea: ['#020409', '#04081a', '#0a2472', '#1450a3', '#247ba0', '#2ec4b6', '#70c1b3', '#b2dbbf', '#231651', '#f4f4f4'],
};

export const DEFAULT_PALETTE_COLORS = [
  '#1a1a1a', '#ffffff', '#e74c3c', '#ff7043', '#f5c518', '#8bc34a', '#1e88e5', '#5e35b1',
];

const FRAME_LIMIT = 15;
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
/** How much of the canvas must stay inside .pixel-canvas-wrap after any pan (screen px, per axis) -
 *  or the whole canvas, when it's smaller than that. Panning is otherwise free-form (no scroll
 *  container clamps it any more, see clampPan), and without a stop the canvas can be flung out of
 *  view entirely with nothing on screen to say where it went. */
const PAN_EDGE_MARGIN_PX = 56;
/** Onion skin: most frames shown per direction, and the nearest frame's default alpha. */
export const ONION_MAX_DEPTH = 3;
export const ONION_DEFAULT_OPACITY = 0.45;
export const ONION_MIN_OPACITY = 0.1;
const ONION_TINT_BEFORE = '#ff4d4d';
const ONION_TINT_AFTER = '#4d94ff';
const PREVIEW_CELL_PX_BASE = 96;
/** Above this many cells, the preview panel stops repainting *during* a stroke and waits for the stroke
 *  to end (see schedulePreviewRepaint). A preview repaint costs a full compositeToBitmap over every
 *  layer at the sprite's native resolution - nothing on a 32x32 fish, but hundreds of ms on a
 *  background-sized canvas (see restartPreviewTimer's doc comment for that profile). Small sprites, the
 *  overwhelmingly common case here, still update live mid-stroke. */
const PREVIEW_LIVE_CELL_LIMIT = 128 * 128;
export const MAX_BRUSH_SIZE = 20;
/** Tools that share the brush-size stepper (see CanvasStatusBar's `showBrushOptions` / PixelCanvas's
 *  brush-footprint preview) and one shared size (see brushSizes/brushSizeToolKey), so switching between
 *  them keeps the same size. Line/rect/ellipse/curve all read the same `brushSize` to thicken their
 *  outline (see each tool's own `shapeCells`/`quadraticBezierCells` in `src/lib/tools/tools/`) -
 *  gradient and the selection tools have no comparable "stroke width" concept, so they're deliberately
 *  left out. */
export const BRUSH_SIZE_TOOLS = new Set<ToolName>(['pen', 'eraser', 'spray', 'line', 'rect', 'ellipse', 'curve']);
const SPRAY_INTERVAL_MS = 55;
export const MIN_SPRAY_DENSITY = 0.25;
export const MAX_SPRAY_DENSITY = 3;
const TOOL_KEYS: Record<string, ToolName> = {
  b: 'pen', e: 'eraser', f: 'fill', i: 'eyedropper', l: 'line', u: 'curve', r: 'rect', c: 'ellipse',
  a: 'spray', k: 'gradient', m: 'select', q: 'lasso', w: 'magicWand', v: 'move',
};
/** Tools where a right-click has an alternate meaning (erase, or reversed gradient) instead of opening the browser context menu. */
const ERASABLE_TOOLS = new Set<ToolName>(['pen', 'eraser', 'line', 'curve', 'rect', 'ellipse', 'fill', 'spray', 'gradient']);
/** Tools where holding Alt temporarily samples a color instead of the tool's normal action. */
const ALT_PICK_TOOLS = new Set<ToolName>(['pen', 'eraser', 'line', 'curve', 'rect', 'ellipse', 'fill', 'spray', 'gradient']);
/** Tools that create/edit a selection - rectangular marquee, freeform lasso, and Magic Wand's
 *  color-matched region are three ways to make the same kind of selection (see
 *  selectionMask/lassoPoints), so they share all of its chrome/rules. */
const SELECTION_TOOLS = new Set<ToolName>(['select', 'lasso', 'magicWand']);
/** SELECTION_TOOLS plus 'move' - the selection border (marching ants) and its move-cursor hint stay
 *  visible/active while the Move tool is selected too, not just while actively editing the selection
 *  shape, so switching to Move to drag a selection doesn't make it look like nothing is selected. */
const SELECTION_AWARE_TOOLS = new Set<ToolName>(['select', 'lasso', 'magicWand', 'move']);

/** Tools migrated to the new Tool/Gesture architecture (src/lib/tools/) - see that directory's
 *  ARCHITECTURE.md for the design and the rest of the migration plan. Every other ToolName still runs
 *  on the legacy inline `if (this.tool === 'xxx')` handling directly below. Built once at module scope
 *  since the `createXTool()` factories are pure and stateless. */
const TOOL_REGISTRY: Partial<Record<ToolName, Tool>> = {
  pen: createPenTool(false),
  eraser: createPenTool(true),
  rect: createShapeTool('rect'),
  ellipse: createShapeTool('ellipse'),
  line: createShapeTool('line'),
  magicWand: createMagicWandTool(),
  move: createMoveTool(),
  select: createSelectTool(),
  lasso: createLassoTool(),
  eyedropper: createEyedropperTool(),
  fill: createFillTool(),
  gradient: createGradientTool(),
  spray: createSprayTool(),
  curve: createCurveTool(),
};
/** Tools whose gestures never touch a pixel - adjusting a selection isn't an edit, so
 *  `beginToolGesture` skips `pushGestureUndo()` for these entirely (matches `applyMagicWandAt`'s own
 *  doc comment, which the same reasoning always applied to Select/Lasso's marquee/lasso drags too). */
const NO_UNDO_TOOLS = new Set<ToolName>(['magicWand', 'select', 'lasso', 'eyedropper']);

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

type Snapshot = HistorySnapshot;

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
  /** Scratch canvas reused by paintTintedOnion to tint one onion-skin frame at a time before blitting
   *  it onto the real canvas - see paintOnionSkin. */
  private onionBitmap: HTMLCanvasElement | null = null;

  sprites: Sprite[] = [];
  current: Sprite = blankSprite();
  frameIndex = 0;
  activeLayerIndex = 0;
  tool: ToolName = 'pen';
  color = DEFAULT_PALETTE_COLORS[3];
  paletteColors: string[] = [];
  savedColors: string[] = [];
  painting = false;
  /** Where the last freehand pen/eraser stroke ended, kept *across* strokes so a following Shift+click
   *  can draw a straight line from there - the Photoshop/Aseprite convention for chaining segments
   *  without switching to the Line tool. Set by the migrated pen/eraser tool via `GestureResult.
   *  finalCell` (see commitGestureResult). Bounds-checked at use rather than cleared everywhere, since
   *  the canvas can be resized or a different sprite loaded under it. */
  lastStrokeEndCell: Cell | null = null;
  /** True while Alt is held with a paint tool active - see ALT_PICK_TOOLS. Alt has always temporarily
   *  sampled a color on click, but nothing said so until the click had already happened; this drives the
   *  eyedropper cursor on .pixel-canvas-wrap so the mode is visible while the key is down. */
  altPickActive = false;
  shapeFilled = false;
  selection: SelectionBox | null = null;
  selectStart: Cell | null = null;
  selectionDraft: SelectionBox | null = null;
  /** Freeform outline for a lasso- or Magic-Wand-made selection (closed polygon, canvas cell coords,
   *  possibly several disjoint loops bridged into one - see traceMaskOutline) - null for a plain
   *  rectangular marquee selection, where the whole `selection` box counts as selected. Kept in
   *  sync with `selection`/`selectionMask` by every op that moves/shifts a selection. */
  lassoPoints: Cell[] | null = null;
  /** In-progress freeform path while dragging out a new lasso selection - promoted to `lassoPoints`
   *  (and used to derive selectionMask) on release; null the rest of the time. */
  lassoDraftPoints: Cell[] | null = null;
  /** Which cells inside `selection`'s bounding box are actually selected - null means "all of them"
   *  (a rectangular marquee selection). Sparse (`"x,y"` keys) rather than a full width×height grid
   *  since a selection is typically a small fraction of a large canvas. Centralizes freeform-selection
   *  awareness in captureSelectionPixels/clearFrameRegion/startMoveGesture/nudgeSelection, so move,
   *  resize, rotate, and copy all naturally respect a lasso's or Magic Wand's actual shape instead of
   *  its bounding box. */
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
  moveDelta = { dx: 0, dy: 0 };
  clipboard: { w: number; h: number; rows: (string | null)[][] } | null = null;
  symmetry: SymmetryMode = 'none';
  /** Draggable symmetry mirror/rotation axis, in cell-space (not persisted - recentered whenever the
   *  canvas is resized or a different sprite loads, see centerSymmetryAxis). Defaults to the canvas
   *  center, matching the old fixed-center behavior exactly (see paintPipeline.ts's `withSymmetry`). */
  symmetryAxisX = storage.DEFAULT_GRID_SIZE / 2;
  symmetryAxisY = storage.DEFAULT_GRID_SIZE / 2;
  private axisDragging = false;
  /** 0-100: how far a fill can spread across similar-but-not-identical colors (see floodFill's
   *  colorsMatch) - 0 keeps the original exact-match flood fill. */
  fillTolerance = 0;
  /** Magic Wand: whether a click selects only the region connected to the clicked pixel (the default)
   *  or every matching pixel in the layer. Holding Shift has always done the latter for one click, but
   *  a modifier nobody can see isn't a setting - this is the same thing as a checkbox that stays put
   *  (see ToolOptionsBar), with Shift left in place as the per-click override. */
  wandContiguous = true;
  /** What the marquee / lasso / Magic Wand do to the existing selection - see SelectionMode. Sticky, so
   *  building a multi-part selection doesn't mean holding a modifier for every one of a dozen clicks;
   *  Shift (add) and Alt (subtract) still override it for a single click or drag. */
  selectionMode: SelectionMode = 'new';
  /** Spray: dots laid down per tick, as a multiple of the default (which scales with brush size - see
   *  sprayTool.ts's `scatterOps`). Under 1 it stipples slowly enough to build up an edge; over 1 it
   *  fills fast. */
  sprayDensity = 1;
  /** Ordered (Bayer 4x4) dither between `color` and `gradientColor` instead of a flat fill - for the
   *  gradient tool (see gradientCellsPreview) and as a "dither brush" texture for pen/spray/shapes
   *  (read into ToolContext; see paintPipeline.ts). */
  ditherEnabled = false;
  /** Colors a user has pinned in the saved-colors row (see ColorPalette.tsx) - survive
   *  clearUnusedColors regardless of use. Persisted separately from savedColors (see storage.ts). */
  pinnedColors: Set<string> = new Set();
  /** How many frames *before* the active one onion skin shows, and how many *after* - independently,
   *  because the two are useful for different things (checking a hand-off from the previous frame vs.
   *  drawing toward the next one) and a single shared "depth" could only ever do both at once. 0 turns
   *  that direction off without turning onion skin off. See paintOnionSkin. */
  onionBefore = 1;
  onionAfter = 1;
  /** Alpha of the *nearest* onion frame; each further one is proportionally fainter (see
   *  paintOnionSkin). The old fixed 0.3 was hard to make out against the checkered transparency
   *  background, which is exactly where onion skin is needed most. */
  onionOpacity = ONION_DEFAULT_OPACITY;
  /** 'tint' recolors onion frames red (before) / blue (after) so their direction is unmistakable;
   *  'original' keeps their real colors and only fades them, which reads better on a sprite whose own
   *  palette is already red/blue heavy. */
  onionColorMode: OnionColorMode = 'tint';
  /** Shows the composited preview tiled 3x3 instead of once, to spot seams on a 'background'-type
   *  sprite meant to repeat (see tickPreview/PreviewPanel.tsx). */
  tiledPreview = false;
  /** Shared brush size across BRUSH_SIZE_TOOLS (see brushSizeToolKey/BRUSH_SIZE_TOOLS), persisted so a
   *  size picked in one session survives a reload. */
  private brushSizes: Record<string, number> = {};
  /** Last-known pointer position over the canvas, in on-screen px relative to .pixel-canvas-inner -
   *  drives the brush-footprint preview outline (see brushPreviewRect) via a DOM overlay rather than a
   *  cursor image, so the outline isn't capped by the browser's max custom-cursor size at large brush
   *  sizes/zoom. Cleared on pointer leave/up so the preview disappears when the cursor isn't over the canvas. */
  hoverPointerPx: { px: number; py: number } | null = null;
  /** Set for the duration of a right-click gesture: paints/fills/erases with the eraser instead of the active color. */
  eraseOverride = false;
  /** Aseprite's Pixel Perfect: drop the redundant corner pixel where a 1px freehand stroke turns, so a
   *  diagonal reads as a clean staircase instead of a doubled-up elbow. Read into `ToolContext` for the
   *  migrated pen tool (which implements the actual corner trim - see penTool.ts); ToolOptionsBar owns
   *  the switch. */
  pixelPerfect = true;
  /** The in-progress gesture for a tool migrated to the new architecture (see TOOL_REGISTRY) - null
   *  whenever the active tool is still on the legacy inline handling below. */
  private activeGesture: Gesture | null = null;
  /** The ToolPointerEvent last given to `activeGesture.onPointerMove` - the real DOM `pointerup` event
   *  carries no position of its own (see onPointerUp's empty signature), so `onPointerUp` replays this
   *  instead rather than re-deriving a position from the up-event. */
  private lastToolPointerEvent: ToolPointerEvent | null = null;
  /** Canvas-clamped rect(s) `activeGesture`'s last preview drew as an *overlay* (not yet committed to
   *  the frame - see ToolPreview's own doc comment) - so a cancelled gesture (Escape, blur) can erase
   *  it - the targeted erase a cancelled overlay preview needs, since the overlay was drawn straight
   *  onto the canvas and a full repaint no longer happens on every frame. */
  private lastGesturePreviewRects: SelectionBox[] | null = null;
  /** Any migrated tool whose Gesture implements `onTick` (currently only Spray) - ticks it on a fixed
   *  interval while its gesture is active, independent of pointer movement. Generic replacement for
   *  the old spray-only `sprayTimer`/`sprayPointerCell`/`sprayTick` trio - see `startGestureTimer`. */
  private gestureTimer: ReturnType<typeof setInterval> | null = null;
  /** Curve tool: null = idle, 'drag-end' = dragging the initial line, 'bend' = adjusting the
   *  control-point handle (idle or being dragged - PixelSelectionOverlay.tsx only distinguishes 'bend'
   *  from not). Mirrored from the active CurveGesture's own internal phase (see
   *  ToolPreview.curvePreview/GestureResult.curvePreview) - CurveGesture itself is the source of truth,
   *  these two fields exist only because PixelSelectionOverlay.tsx (a DOM layer) reads them directly to
   *  place the draggable bend handle, the same reason `selectionDraft`/`moveDelta` are mirrored fields
   *  too. */
  curvePhase: 'drag-end' | 'bend' | null = null;
  curveControl: Cell | null = null;
  gradientColor = '#ffffff';
  /** Gradient blend shape - see GradientType / ToolOptionsBar's picker. Sticky across sprites, like
   *  brushSize/symmetry. */
  gradientType: GradientType = 'linear';
  gradientStart: Cell | null = null;
  gradientEnd: Cell | null = null;
  gradientPreview: MoveBufferCell[] | null = null;
  /** Continuous zoom factor (1 = 100%) - not locked to ZOOM_LEVELS's fixed steps, which remain only as
   *  quick-pick presets in the status bar. Clamped to [minZoomScale(), maxZoomScale()] by setZoom;
   *  also set directly (via defaultZoomForSize) wherever the canvas's own width/height changes -
   *  resize, trim, or loading/creating/importing a sprite - since a zoom level picked for one sprite's
   *  dimensions can otherwise overflow .pixel-canvas-wrap for a differently-sized one it carries over
   *  to, with no visible sign beyond a stray scrollbar (place-items:center hides the clipped edges). */
  zoomScale = 1;
  /** The view offset (screen px), applied as a transform on .pixel-canvas-inner on top of the CSS
   *  centering .pixel-canvas-wrap gives it. This is now the *only* way the view moves: the wrap used to
   *  be overflow:auto and pan was split between native scrollLeft/scrollTop and this transform, which
   *  meant a scrollbar appearing or disappearing mid-stroke resized the wrap's content box and visibly
   *  jumped the canvas out from under the cursor. The wrap is overflow:hidden now (see index.css) and
   *  every pan - hand-drag, wheel, scrollbar, zoom anchoring - goes through panBy/clampPan instead, so
   *  nothing about the view depends on layout that can change while drawing. Reset to 0 wherever the
   *  view should snap back to a plain default (zoomToFit, a resized canvas, a different sprite) rather
   *  than carry over a stale offset from whatever was on screen before. */
  panX = 0;
  panY = 0;
  /** The pan currently written into .pixel-canvas-inner's transform, which is what the canvas's measured
   *  rect reflects. Distinct from panX/panY, which are already the *next* value by the time clampPan
   *  measures: subtracting the new pan from a rect still showing the old one made viewMetrics' `restX`
   *  drift by exactly one pan step, so a fast drag stopped short of the real clamp. Only applyPanToDom
   *  writes these, and it's the only thing that writes the transform. */
  private appliedPanX = 0;
  private appliedPanY = 0;
  /** True for the duration of a middle-mouse-button drag, panning the view via the wrap's native scroll
   *  regardless of the active tool - see onPointerDown/Move/Up. Deliberately doesn't reuse `painting`
   *  (and isn't itself gated by it): this needs to work mid-stroke, mid-shape-drag, etc. without
   *  disturbing whatever the primary button is doing, the same way it works in Paint/Photoshop/Pixilart. */
  private middlePanActive = false;
  /** The mouse buttons held when the current gesture started (MouseEvent.buttons bitmask) - see
   *  onPointerMove's second-button abort. 0 between gestures. */
  private gestureButtons = 0;
  /** Last pointer position (client px) seen during a middle-pan drag, to derive each move's delta -
   *  null the rest of the time. */
  private middlePanLast: { x: number; y: number } | null = null;
  /** True while the space bar is held (see onKeyDown/window keyup listener in init) - a primary-button
   *  drag pans the view the same way a middle-click drag already does (see onPointerDown), the common
   *  Paint/Photoshop/Pixilart "hold space to pan" convention. */
  private spacePanActive = false;
  showGrid = true;
  canvasBackground: CanvasBackground = 'checker-dark';
  onionSkin = false;
  transformAllFrames = false;
  /** Undo/redo as diff-based `HistoryEntry`s (see src/lib/undoHistory.ts) - a `'cells'` entry holds
   *  just the changed rectangle of the changed frame, `'full'` a whole-snapshot pair for structural
   *  changes. `historyPending` is the single full snapshot taken at the last `pushUndo()` ("state
   *  before the in-progress edit"), compacted into an entry lazily on the next `pushUndo`/`undo`/
   *  `redo` (see `finalizeHistoryPending`). */
  undoStack: HistoryEntry[] = [];
  redoStack: HistoryEntry[] = [];
  private historyPending: Snapshot | null = null;
  previewFrame = 0;
  dirty = false;
  active = true;
  /** Bumped only when a *different* sprite becomes current (new/load), never on save-in-place. */
  loadToken = 0;

  private previewTimer: ReturnType<typeof setInterval> | null = null;
  /** Set by schedulePreviewRepaint whenever the sprite's pixels change, cleared once the pending rAF
   *  actually repaints - see that method for why the repaint is deferred to a frame boundary. */
  private previewDirty = false;
  private previewRepaintRafId: number | null = null;
  private reactNotify: () => void = () => {};
  private notifyRafId: number | null = null;
  private windowListeners: Array<() => void> = [];
  /** Captured right before a gesture's own pushUndo (see pushGestureUndo) so that entry can be rolled
   *  straight back off the stack - with the dirty flag and the redo stack it clobbered - if the gesture
   *  turns out to change nothing or gets cancelled. null whenever no such entry is outstanding. */
  private gestureUndoState: { dirty: boolean; redo: HistoryEntry[] } | null = null;

  init(notify: () => void): void {
    // rAF-coalesced, not a direct call to `notify` - a fast pointer (pen/spray tools especially)
    // can call reactNotify() many times between two browser paints, and
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
    this.pinnedColors = new Set(storage.loadPinnedColors());
    this.canvasBackground = storage.loadCanvasBackground() ?? 'checker-dark';
    const onion = storage.loadOnionSettings();
    if (onion) {
      this.onionSkin = onion.enabled;
      this.onionBefore = onion.before;
      this.onionAfter = onion.after;
      this.onionOpacity = onion.opacity;
      this.onionColorMode = onion.colorMode;
    }
    this.brushSizes = storage.loadBrushSizes();
    this.centerSymmetryAxis();

    this.restartPreviewTimer();

    const endGesture = () => this.onPointerUp();
    const forceEndGesture = () => {
      this.middlePanActive = false;
      this.middlePanLast = null;
      this.spacePanActive = false;
      // A keyup that happens while the window is blurred never reaches this listener, so the modifier
      // would otherwise stay latched on until the next press.
      this.setAltPick(false);
      if (this.canvas) this.canvas.style.cursor = '';
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
    const onKeyUpGlobal = (e: KeyboardEvent) => this.onKeyUp(e);

    window.addEventListener('pointerup', endGesture);
    window.addEventListener('pointercancel', endGesture);
    window.addEventListener('blur', forceEndGesture);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('keydown', onKeyDownGlobal);
    document.addEventListener('keyup', onKeyUpGlobal);

    this.windowListeners = [
      () => window.removeEventListener('pointerup', endGesture),
      () => window.removeEventListener('pointercancel', endGesture),
      () => window.removeEventListener('blur', forceEndGesture),
      () => document.removeEventListener('visibilitychange', onVisibility),
      () => window.removeEventListener('beforeunload', onBeforeUnload),
      () => document.removeEventListener('keydown', onKeyDownGlobal),
      () => document.removeEventListener('keyup', onKeyUpGlobal),
    ];

    this.reactNotify();
  }

  destroy(): void {
    if (this.previewTimer) clearInterval(this.previewTimer);
    if (this.previewRepaintRafId !== null) {
      cancelAnimationFrame(this.previewRepaintRafId);
      this.previewRepaintRafId = null;
    }
    if (this.gestureTimer) clearInterval(this.gestureTimer);
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

  private refresh(): void {
    this.drawGrid();
    this.syncPreviewTimer();
    this.schedulePreviewRepaint();
    this.reactNotify();
  }

  attachCanvas(el: HTMLCanvasElement | null): void {
    this.canvas = el;
    this.ctx = el ? el.getContext('2d') : null;
    if (el) {
      this.recomputeCanvasSize();
      this.drawGrid();
    }
  }

  attachPreviewCanvas(el: HTMLCanvasElement | null): void {
    const isNew = el !== null && el !== this.previewCanvas;
    this.previewCanvas = el;
    this.previewCtx = el ? el.getContext('2d') : null;
    // A freshly attached canvas is blank until something paints it, and for a single-frame sprite no
    // timer ever will - paint it once here so the panel isn't empty until the first edit.
    if (isNew) this.paintPreview();
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
    // A pending baseline is an edit not yet compacted into an entry - undo() finalizes it first, so
    // it counts. (When the edit turned out to be a no-op, undo() finds nothing and the button was
    // momentarily live for nothing - the same harmless edge the old always-push behavior had.)
    return this.undoStack.length > 0 || this.historyPending !== null;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  // --- tool / color / toggles ---

  setTool(tool: ToolName): void {
    if (tool === this.tool) return;
    // A tool can be switched from the rail or the keyboard while a gesture is still technically in
    // flight - a pointer capture lost to a system dialog, a touch that ended off-canvas. Settle it
    // against the tool that started it rather than leaving half-finished state (a shape start cell, a
    // lifted move buffer) for the incoming tool's handlers to interpret as their own.
    if (this.painting) this.resetGestureState();
    // Curve only: a pending bezier survives resetGestureState() above (see its own doc comment - only
    // painting=true gestures get reset there) whenever the switch happens mid-bend with no button held.
    // Auto-commits it, matching the original's own commitCurve() call here exactly - switching tools
    // away always commits a pending curve, never silently discards it.
    if (this.activeGesture) {
      const r = this.activeGesture.onKeyDown?.('Enter', this.buildToolContext());
      if (r) this.commitGestureResult(r);
    }
    if (this.activeGesture) this.stopGestureTimer();
    this.tool = tool;
    if (this.canvas && !SELECTION_AWARE_TOOLS.has(tool)) this.canvas.style.cursor = '';
    // Re-evaluated against the new tool: Alt means nothing on e.g. the Select tool, so the eyedropper
    // hint must not survive a switch onto one.
    if (this.altPickActive && !ALT_PICK_TOOLS.has(tool)) this.altPickActive = false;
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
    if (this.pinnedColors.has(color)) {
      const next = new Set(this.pinnedColors);
      next.delete(color);
      this.pinnedColors = next;
      storage.savePinnedColors([...next]);
    }
    storage.saveSavedColors(this.savedColors);
    this.reactNotify();
  }

  isPinnedColor(color: string): boolean {
    return this.pinnedColors.has(color);
  }

  togglePinColor(color: string): void {
    const next = new Set(this.pinnedColors);
    if (next.has(color)) next.delete(color);
    else next.add(color);
    this.pinnedColors = next;
    storage.savePinnedColors([...next]);
    this.reactNotify();
  }

  /** Drag-to-reorder for the saved-colors row (see ColorPalette.tsx) - same splice-and-reinsert shape
   *  as moveLayer/moveFrame elsewhere in this file. */
  reorderSavedColor(from: number, to: number): void {
    if (from === to || from < 0 || to < 0 || from >= this.savedColors.length || to >= this.savedColors.length) return;
    const next = [...this.savedColors];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    this.savedColors = next;
    storage.saveSavedColors(this.savedColors);
    this.reactNotify();
  }

  /** Drops every saved color that's neither pinned nor actually painted anywhere in the current
   *  sprite - a one-click way to prune a savedColors list that otherwise only ever grows. */
  clearUnusedColors(): void {
    const used = new Set<string>();
    this.current.frames.forEach((layers) => layers.forEach((layer) => layer.cells.forEach((c) => c && used.add(c))));
    const next = this.savedColors.filter((c) => this.pinnedColors.has(c) || used.has(c));
    if (next.length === this.savedColors.length) return;
    this.savedColors = next;
    storage.saveSavedColors(this.savedColors);
    this.reactNotify();
  }

  /** Overwrites the top (fixed-position) palette row with one of PRESET_PALETTES - a quick underwater-
   *  themed starting point, distinct from the user's own growing savedColors list. */
  applyPresetPalette(name: string): void {
    const preset = PRESET_PALETTES[name];
    if (!preset) return;
    this.paletteColors = [...preset];
    storage.savePaletteColors(this.paletteColors);
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
    this.persistOnionSettings();
    this.refresh();
  }

  setOnionBefore(depth: number): void {
    const clamped = Math.min(ONION_MAX_DEPTH, Math.max(0, Math.round(depth)));
    if (clamped === this.onionBefore) return;
    this.onionBefore = clamped;
    this.persistOnionSettings();
    this.refresh();
  }

  setOnionAfter(depth: number): void {
    const clamped = Math.min(ONION_MAX_DEPTH, Math.max(0, Math.round(depth)));
    if (clamped === this.onionAfter) return;
    this.onionAfter = clamped;
    this.persistOnionSettings();
    this.refresh();
  }

  setOnionOpacity(v: number): void {
    const clamped = Math.min(1, Math.max(ONION_MIN_OPACITY, v));
    if (clamped === this.onionOpacity) return;
    this.onionOpacity = clamped;
    this.persistOnionSettings();
    this.refresh();
  }

  setOnionColorMode(mode: OnionColorMode): void {
    if (mode === this.onionColorMode) return;
    this.onionColorMode = mode;
    this.persistOnionSettings();
    this.refresh();
  }

  private persistOnionSettings(): void {
    storage.saveOnionSettings({
      enabled: this.onionSkin,
      before: this.onionBefore,
      after: this.onionAfter,
      opacity: this.onionOpacity,
      colorMode: this.onionColorMode,
    });
  }

  setTiledPreview(v: boolean): void {
    this.tiledPreview = v;
    // Repainted explicitly: this toggle changes how the preview is drawn without changing a single
    // pixel of the sprite, so none of the content-change paths that call schedulePreviewRepaint()
    // (refresh/redrawRegions) run for it.
    this.paintPreview();
    this.reactNotify();
  }

  setFillTolerance(v: number): void {
    this.fillTolerance = Math.min(100, Math.max(0, Math.round(v)));
    this.reactNotify();
  }

  setWandContiguous(v: boolean): void {
    this.wandContiguous = v;
    this.reactNotify();
  }

  setSelectionMode(mode: SelectionMode): void {
    this.selectionMode = mode;
    this.reactNotify();
  }

  setSprayDensity(v: number): void {
    this.sprayDensity = Math.min(MAX_SPRAY_DENSITY, Math.max(MIN_SPRAY_DENSITY, v));
    this.reactNotify();
  }

  setPixelPerfect(v: boolean): void {
    this.pixelPerfect = v;
    this.reactNotify();
  }

  setDitherEnabled(v: boolean): void {
    this.ditherEnabled = v;
    this.reactNotify();
  }

  setGradientType(type: GradientType): void {
    this.gradientType = type;
    this.reactNotify();
  }

  /** Swaps the primary (`color`) and secondary (`gradientColor`) active colors - the "X" shortcut
   *  (see onKeyDown) and the gradient panel's own swap button share this. */
  swapColors(): void {
    const c = this.color;
    this.color = this.gradientColor;
    this.gradientColor = c;
    this.reactNotify();
  }

  setSymmetry(mode: SymmetryMode): void {
    this.symmetry = mode;
    this.refresh();
  }

  /** Recenters the draggable symmetry axis on the current canvas - called whenever the canvas's own
   *  size changes (setGridSize, trimToContent, a resizing transform, loading a different sprite) so a
   *  stale axis position from a previous, differently-sized canvas doesn't carry over. */
  private centerSymmetryAxis(): void {
    this.symmetryAxisX = this.current.width / 2;
    this.symmetryAxisY = this.current.height / 2;
  }

  /** Manual "put the axis back in the middle" action for the status bar, next to the symmetry picker. */
  resetSymmetryAxis(): void {
    this.centerSymmetryAxis();
    this.refresh();
  }

  /** Starts dragging the symmetry axis handle - called from its own pointerdown (see
   *  PixelSelectionOverlay.tsx), same "DOM handle drives an engine gesture" pattern as the selection's
   *  resize/rotate handles. */
  startAxisDrag(): void {
    this.axisDragging = true;
  }

  updateAxisDrag(e: { clientX: number; clientY: number }): void {
    if (!this.axisDragging) return;
    const pt = this.pxFromEvent(e);
    if (!pt) return;
    const cellPx = this.effectiveCellPx();
    const { width, height } = this.current;
    this.symmetryAxisX = Math.min(width, Math.max(0, pt.px / cellPx));
    this.symmetryAxisY = Math.min(height, Math.max(0, pt.py / cellPx));
    this.refresh();
  }

  endAxisDrag(): void {
    this.axisDragging = false;
  }

  /** All BRUSH_SIZE_TOOLS share one size slot, so switching tools keeps the same brush size instead of
   *  each tool remembering its own. */
  private brushSizeToolKey(): string {
    return 'shared';
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
    // Unconditional now that the status bar shows live cursor coordinates (see hoverCell) - it used to
    // be gated on the brush tools, the only thing that needed a re-render per move back then.
    // reactNotify coalesces to one render per animation frame, so this stays one render per displayed
    // frame while the pointer moves, not one per pointer event.
    this.reactNotify();
  }

  clearHoverPointer(): void {
    if (!this.hoverPointerPx) return;
    this.hoverPointerPx = null;
    this.reactNotify();
  }

  /** Where PixelSelectionOverlay.tsx should draw the brush-footprint preview outline: a `brushSize`
   *  cells-wide square, snapped to the top-left-anchored cell grid a brush click paints - so the
   *  outline shows exactly which cells a click would paint, not just an approximate box centered on the
   *  raw pointer position. Null when there's nothing to show (pointer not over the canvas, or the
   *  active tool doesn't use a brush size). */
  /** Which cell the pointer is over, for the status bar's coordinate readout - null when it isn't over
   *  the canvas, and also when it's over the wrap but outside the canvas's own bounds, since a
   *  coordinate outside the sprite isn't a coordinate the user can do anything with. */
  hoverCell(): Cell | null {
    if (!this.hoverPointerPx) return null;
    const cellPx = this.effectiveCellPx();
    const x = Math.floor(this.hoverPointerPx.px / cellPx);
    const y = Math.floor(this.hoverPointerPx.py / cellPx);
    const { width, height } = this.current;
    return x >= 0 && y >= 0 && x < width && y < height ? { x, y } : null;
  }

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
   * that point actually rendered before and after the resize, then correcting the gap through panX/panY
   * (see absorbPanCorrection) - the transform on .pixel-canvas-inner that is now the only thing moving
   * the view. Measuring the canvas's actual rendered rect, rather than computing where it "should" be,
   * means this stays correct whether the current position comes from CSS centering, a prior pan, or
   * both: getBoundingClientRect() always reports the final on-screen result of everything together.
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
      // gap.
      this.absorbPanCorrection(naturalX - anchor.clientX, naturalY - anchor.clientY);
    }
    this.reactNotify();
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
   * wrap overflow:hidden and moving the view entirely into the transform (see panX/panY) deletes both
   * problems rather than balancing them.
   */
  private absorbPanCorrection(dx: number, dy: number): void {
    this.panX -= dx;
    this.panY -= dy;
    this.clampPan();
    this.applyPanToDom();
  }

  /**
   * Wrap (viewport) and canvas geometry that the pan clamp and the overlay scrollbars both work from,
   * all in the wrap's padding-box coordinates. `restX`/`restY` are where the canvas's top-left corner
   * sits with pan at 0 - measured (current rect minus the pan currently in the transform), not derived
   * from the CSS.
   *
   * Measured because deriving it is wrong in exactly the case that matters: .pixel-canvas-wrap centers
   * with grid `place-items: center`, which suggests an oversized canvas rests at (wrapW - canvasW) / 2,
   * overflowing equally on both sides. It doesn't - a grid item larger than its area resolves to the
   * content box's start edge instead, so its resting offset is 0, not a large negative number. Assuming
   * the centered value made the pan clamp wrong by exactly that difference in *opposite* directions on
   * the two edges: one direction stopped while the canvas still filled the whole viewport, the other let
   * it be dragged entirely off screen. Measuring is also robust to any future change in how the wrap
   * lays its content out, which deriving would silently break again.
   *
   * Null before the canvas is attached.
   */
  viewMetrics(): {
    wrapW: number;
    wrapH: number;
    canvasW: number;
    canvasH: number;
    restX: number;
    restY: number;
  } | null {
    const wrap = this.canvas?.parentElement?.parentElement as HTMLElement | null;
    if (!wrap || !this.canvas) return null;
    const wrapRect = wrap.getBoundingClientRect();
    const canvasRect = this.canvas.getBoundingClientRect();
    return {
      wrapW: wrap.clientWidth,
      wrapH: wrap.clientHeight,
      canvasW: canvasRect.width,
      canvasH: canvasRect.height,
      // clientLeft/clientTop are the border widths - subtracting them puts these in the same padding-box
      // coordinates as clientWidth/clientHeight above, which is also what `position: absolute` uses for
      // the overlay scrollbars.
      restX: canvasRect.left - wrapRect.left - wrap.clientLeft - this.appliedPanX,
      restY: canvasRect.top - wrapRect.top - wrap.clientTop - this.appliedPanY,
    };
  }

  /** Keeps at least PAN_EDGE_MARGIN_PX of canvas inside the wrap on each axis (or the whole canvas, when
   *  it's smaller than that margin). Written in terms of the measured resting offset from viewMetrics -
   *  see there for why that isn't computed from the wrap's centering. */
  private clampPan(): void {
    const m = this.viewMetrics();
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
    const inner = this.canvas?.parentElement as HTMLElement | null;
    if (!inner) return;
    inner.style.transform = this.panX || this.panY ? `translate(${this.panX}px, ${this.panY}px)` : '';
    this.appliedPanX = this.panX;
    this.appliedPanY = this.panY;
  }

  /** Snaps the view back to its default position. Every "the view should start fresh" site goes through
   *  this rather than assigning panX/panY directly, so the transform (and appliedPanX/Y with it) can
   *  never be left describing a pan that's already been zeroed. */
  private clearPan(): void {
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
    if (notify) this.reactNotify();
  }

  /** Recentres the view without changing zoom - the escape hatch when the canvas has been panned
   *  somewhere unhelpful. */
  resetPan(): void {
    this.clearPan();
    this.reactNotify();
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
    this.clearPan();
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
  setGridSize(
    newWidth: number,
    newHeight: number,
    type: SpriteType,
    mode: ResizeMode = 'stretch',
    anchor: ResizeAnchor = 'middle-center'
  ): void {
    const minSize = type === 'background' ? storage.MIN_BACKGROUND_GRID_SIZE : storage.MIN_GRID_SIZE;
    const clampedWidth = Math.max(minSize, newWidth);
    const clampedHeight = Math.max(minSize, newHeight);
    if (clampedWidth === this.current.width && clampedHeight === this.current.height) return;
    this.pushUndo();
    const { width, height } = this.current;
    if (mode === 'crop') {
      const frac = storage.RESIZE_ANCHOR_FRAC[anchor];
      const offsetX = Math.round((clampedWidth - width) * frac.x);
      const offsetY = Math.round((clampedHeight - height) * frac.y);
      this.current.frames = this.current.frames.map((layers) =>
        layers.map((layer) => ({ ...layer, cells: storage.padFrame(layer.cells, width, height, clampedWidth, clampedHeight, offsetX, offsetY) }))
      );
    } else {
      this.current.frames = this.current.frames.map((layers) =>
        layers.map((layer) => ({ ...layer, cells: storage.resampleFrame(layer.cells, width, height, clampedWidth, clampedHeight) }))
      );
    }
    this.current.width = clampedWidth;
    this.current.height = clampedHeight;
    this.zoomScale = this.defaultZoomForSize(Math.max(clampedWidth, clampedHeight));
    this.clearPan();
    this.frameIndex = Math.min(this.frameIndex, this.current.frames.length - 1);
    this.selection = null;
    this.lassoPoints = null;
    this.selectionMask = null;
    this.centerSymmetryAxis();
    this.recomputeCanvasSize();
    this.refresh();
  }

  /** Auto-crops fully-transparent borders shared by every layer of every frame (a "content" pixel in
   *  any frame/layer keeps that column/row for all of them, since every frame in a sprite must share
   *  one size) - the one-click counterpart to a manual crop resize. No-op when there's no content at
   *  all, or the content already fills the canvas exactly. */
  trimToContent(): void {
    const { width, height, frames } = this.current;
    let x0 = width, y0 = height, x1 = -1, y1 = -1;
    frames.forEach((layers) => {
      layers.forEach((layer) => {
        const cells = layer.cells;
        for (let y = 0; y < height; y++) {
          const rowStart = y * width;
          for (let x = 0; x < width; x++) {
            if (!cells[rowStart + x]) continue;
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      });
    });
    if (x1 < x0) return;
    // Trimming only ever shrinks - never let it go below the type-appropriate floor that setGridSize
    // itself enforces (300 for backgrounds, 4 otherwise), by growing the trim bounds back out (still
    // within the original canvas, which is always >= that floor already) before applying them.
    const minSize = this.current.type === 'background' ? storage.MIN_BACKGROUND_GRID_SIZE : storage.MIN_GRID_SIZE;
    [x0, x1] = this.expandRangeToMin(x0, x1, width, minSize);
    [y0, y1] = this.expandRangeToMin(y0, y1, height, minSize);
    const newWidth = x1 - x0 + 1;
    const newHeight = y1 - y0 + 1;
    if (newWidth === width && newHeight === height && x0 === 0 && y0 === 0) return;
    this.pushUndo();
    this.current.frames = this.current.frames.map((layers) =>
      layers.map((layer) => ({ ...layer, cells: storage.padFrame(layer.cells, width, height, newWidth, newHeight, -x0, -y0) }))
    );
    this.current.width = newWidth;
    this.current.height = newHeight;
    this.zoomScale = this.defaultZoomForSize(Math.max(newWidth, newHeight));
    this.clearPan();
    this.selection = null;
    this.lassoPoints = null;
    this.selectionMask = null;
    this.centerSymmetryAxis();
    this.recomputeCanvasSize();
    this.refresh();
  }

  /** Grows a [lo, hi] range (inclusive) symmetrically, clamped to [0, total-1], until it's at least
   *  `minLen` long - used by trimToContent to keep a trim from shrinking a sprite below its type's
   *  minimum size. Assumes `total >= minLen` (true here since the untrimmed canvas already respects
   *  the same floor, via setGridSize), so there's always room. */
  private expandRangeToMin(lo: number, hi: number, total: number, minLen: number): [number, number] {
    const deficit = minLen - (hi - lo + 1);
    if (deficit <= 0) return [lo, hi];
    const growLeft = Math.floor(deficit / 2);
    const growRight = deficit - growLeft;
    lo -= growLeft;
    hi += growRight;
    if (lo < 0) {
      hi += -lo;
      lo = 0;
    }
    if (hi > total - 1) {
      lo -= hi - (total - 1);
      hi = total - 1;
    }
    lo = Math.max(0, lo);
    return [lo, hi];
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

  /** Adds a new layer from an uploaded photo, resampled to the sprite's exact canvas size (unlike
   *  pixelateImageFile's own aspect-preserving fit, which usually won't be exactly width x height) and
   *  set to half opacity so it reads as a trace reference over existing art rather than opaque content. */
  async importImageAsLayer(file: File): Promise<void> {
    if (this.layers().length >= LAYER_LIMIT) return;
    const { width, height } = this.current;
    const result = await pixelateImageFile(file, width, height);
    const cells = storage.resampleFrame(result.frame, result.width, result.height, width, height);
    this.pushUndo();
    const layers = this.layers();
    const layer = storage.makeLayer(cells, `Reference ${layers.length + 1}`);
    layer.opacity = 0.5;
    layers.push(layer);
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

  /** Cyclically shifts every layer of the current frame by half the canvas's width/height, so a seam
   *  between tiled repeats of a 'background' sprite (see the tiled 3x3 preview toggle) lands in the
   *  middle of the canvas where it's easy to see and paint over, instead of split across the four edges. */
  applyWrapShift(): void {
    this.pushUndo();
    const { width, height } = this.current;
    this.layers().forEach((layer) => {
      layer.cells = wrapShiftFrame(layer.cells, width, height);
    });
    // refresh() covers the preview too (it calls schedulePreviewRepaint), which matters here because
    // seeing the effect in the tiled preview is the whole point of this action.
    this.refresh();
  }

  /** Copies one layer (by index, in the *current* frame) onto every other frame - appended as a new
   *  top layer there, skipped for any frame already at LAYER_LIMIT. This is deliberately the small
   *  version of "linked layers": a one-shot copy, not a live-shared layer identity kept in sync across
   *  frames (that would need a bigger data-model change - see project notes). */
  copyLayerToAllFrames(index: number): void {
    const layers = this.layers();
    const source = layers[index];
    if (!source || this.current.frames.length <= 1) return;
    this.pushUndo();
    this.current.frames.forEach((frameLayers, fi) => {
      if (fi === this.frameIndex || frameLayers.length >= LAYER_LIMIT) return;
      const cloned: Layer = structuredClone(source);
      cloned.id = storage.uid('layer');
      frameLayers.push(cloned);
    });
    this.refresh();
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
    this.centerSymmetryAxis();
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
    // Not gated on the focus check below: Alt is a modifier, not a command, and the cursor should say
    // "this will sample a color" the moment it's held regardless of what happens to be focused.
    // Deliberately no preventDefault - that would suppress the browser's own Alt shortcuts.
    if (e.key === 'Alt') this.setAltPick(true);
    const el = document.activeElement as HTMLElement | null;
    const tag = el?.tagName ?? '';
    const isRange = tag === 'INPUT' && (el as HTMLInputElement).type === 'range';
    // Typing into a field must never double as a shortcut - except on a range slider (brush size,
    // tolerance, spray density), which has no text to type into. Blocking everything while one of those
    // had focus meant that after nudging the brush size the tool shortcuts silently stopped working
    // until you clicked somewhere else, with nothing on screen explaining why. The keys the slider
    // itself uses are still left to it.
    if ((tag === 'INPUT' && !isRange) || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (isRange && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) return;
    if (!this.active) return;
    if (this.painting) {
      // Esc is the one key that has to get through mid-gesture: it's the way out of a drag that started
      // in the wrong place, and without it the only escape from one is finishing the shape and undoing
      // it afterwards. Everything else stays blocked so a stray keypress can't swap tools or colors out
      // from under a stroke in progress.
      if (e.key === 'Escape') {
        e.preventDefault();
        this.cancelGesture();
      }
      return;
    }

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
    if ((e.ctrlKey || e.metaKey) && key === 'a') {
      e.preventDefault();
      this.selectAll();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && key === 'x') {
      e.preventDefault();
      this.cutSelection();
      return;
    }
    if ((key === 'delete' || key === 'backspace') && this.selection) {
      e.preventDefault();
      this.pushUndo();
      this.clearFrameRegion(this.selection);
      this.refresh();
      return;
    }
    if (key === 'x') {
      e.preventDefault();
      this.swapColors();
      return;
    }
    if (key === ' ') {
      e.preventDefault();
      if (!this.spacePanActive) {
        this.spacePanActive = true;
        if (this.canvas) this.canvas.style.cursor = 'grab';
      }
      return;
    }
    if (key === 'home') {
      e.preventDefault();
      this.resetPan();
      return;
    }
    if (key === 'escape') {
      // Curve only: reachable here (not painting) during bend-idle - `activeGesture` stays set across
      // the drag-end -> bend transition (see GestureResult.keepActive's own doc comment), so the
      // ordinary cancelGesture() path (generalized to check activeGesture, not a curve-specific flag)
      // now handles this uniformly instead of a bespoke cancelCurve().
      if (this.activeGesture) {
        this.cancelGesture();
        return;
      }
      this.deselect();
      return;
    }
    // Curve only: a key pressed during bend-idle outside of an actual drag (e.g. Enter to commit) -
    // `activeGesture` stays set (see above), and only Curve implements `onKeyDown` at all, so this is a
    // no-op for every other tool. Returns null to let the key fall through to the checks below (e.g.
    // arrow-nudge, bracket brush-size) - matches the original's own narrow `key === 'enter'` gate.
    if (this.activeGesture?.onKeyDown) {
      const result = this.activeGesture.onKeyDown(e.key, this.buildToolContext());
      if (result) {
        e.preventDefault();
        this.commitGestureResult(result);
        return;
      }
    }
    if (this.selection && (key === 'arrowup' || key === 'arrowdown' || key === 'arrowleft' || key === 'arrowright')) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = (key === 'arrowleft' ? -1 : key === 'arrowright' ? 1 : 0) * step;
      const dy = (key === 'arrowup' ? -1 : key === 'arrowdown' ? 1 : 0) * step;
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

  private onKeyUp(e: KeyboardEvent): void {
    if (e.key === 'Alt') this.setAltPick(false);
    if (e.key === ' ') {
      this.spacePanActive = false;
      if (!this.middlePanActive && this.canvas) this.canvas.style.cursor = '';
    }
  }

  /** Only notifies React when the flag actually flips - a held-down Alt repeats keydown at the OS's
   *  key-repeat rate, and each one would otherwise schedule a render that changes nothing. */
  private setAltPick(on: boolean): void {
    const next = on && ALT_PICK_TOOLS.has(this.tool);
    if (next === this.altPickActive) return;
    this.altPickActive = next;
    this.reactNotify();
  }

  /** Ctrl+A: select the whole canvas - switches to the Select tool if a non-selection tool was active,
   *  same as clicking it would, so the settled selection's border/handles actually show up. */
  selectAll(): void {
    const { width, height } = this.current;
    this.selection = { x0: 0, y0: 0, x1: width - 1, y1: height - 1 };
    this.lassoPoints = null;
    this.selectionMask = null;
    if (!SELECTION_TOOLS.has(this.tool)) this.tool = 'select';
    this.reactNotify();
  }

  /** Ctrl+X: copy the selection then clear it in place - copySelection reads pixels first, so order
   *  with the clear below doesn't matter, but pushUndo has to happen before the mutation either way. */
  cutSelection(): void {
    if (!SELECTION_TOOLS.has(this.tool) || !this.selection) return;
    this.copySelection();
    this.pushUndo();
    this.clearFrameRegion(this.selection);
    this.refresh();
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
    } else if (this.selectionMask) {
      this.selectionMask = this.shiftMask(this.selectionMask, dx, dy);
    }
    this.moveBuffer = null;
    this.moveDelta = { dx: 0, dy: 0 };
    this.gestureBaseBitmap = null;
    this.refresh();
  }

  private resetGestureState(): void {
    // A migrated tool's (see TOOL_REGISTRY) gesture: erase any uncommitted overlay it left on the
    // canvas bitmap (Pen never leaves one - it commits directly; a shape/curve-equivalent does, see
    // lastGesturePreviewRects' own doc comment), let it do its own cleanup, then forget it. Whatever it
    // already committed progressively (Pen) or lifted into moveBuffer (Move) is handled below the same
    // way legacy gestures always were - either committed back (moveBuffer, right below) or left for the
    // caller's undo-rollback (cancelGesture) to fully restore.
    if (this.activeGesture) {
      if (this.lastGesturePreviewRects) {
        this.redrawRegions(this.lastGesturePreviewRects);
        this.lastGesturePreviewRects = null;
      }
      this.activeGesture.onCancel(this.buildToolContext());
      this.activeGesture = null;
      this.lastToolPointerEvent = null;
      // Curve only: mirrored fields (see ToolPreview.curvePreview/GestureResult.curvePreview's own doc
      // comments) - a null'd-out activeGesture always means curve is fully idle too now, harmless to
      // reset unconditionally for every other tool since they're already null.
      this.curvePhase = null;
      this.curveControl = null;
    }
    // A pending move/resize already cleared its source cells from the frame data
    // at gesture start, so an interrupted gesture must be committed back (at its
    // last known position), never just discarded - dropping it would silently
    // delete the pixels the user picked up.
    if (this.moveBuffer) this.commitMove();
    if (this.resizeHandle) this.commitResize();
    if (this.rotateOrigin) this.commitRotate();
    this.painting = false;
    this.gestureButtons = 0;
    this.selectStart = null;
    this.selectionDraft = null;
    this.lassoDraftPoints = null;
    this.moveBuffer = null;
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
    if (this.gradientStart) {
      // drawGradientPreviewOverlay() paints straight onto the canvas bitmap without a preceding clear
      // (see its own doc comment), so an interrupted gradient drag needs an explicit repaint of the box
      // it covered, not just clearing the state that used to describe it.
      this.redrawRegions([this.selection ?? { x0: 0, y0: 0, x1: this.current.width - 1, y1: this.current.height - 1 }]);
    }
    this.gradientStart = null;
    this.gradientEnd = null;
    this.gradientPreview = null;
    this.stopGestureTimer();
  }

  /** pushUndo, plus enough bookkeeping to drop the pending baseline again - see
   *  gestureUndoState/rollbackGestureUndo. Every gesture that can be cancelled or turn out to be a
   *  no-op goes through this instead of pushUndo directly. */
  private pushGestureUndo(): void {
    this.gestureUndoState = { dirty: this.dirty, redo: this.redoStack };
    this.pushUndo();
  }

  /** Undoes the *bookkeeping* of the current gesture's pushUndo and hands back the baseline snapshot
   *  it took, so the caller can either restore it (a cancel) or drop it (a gesture that changed
   *  nothing). The baseline is still `historyPending` - a gesture in flight is never interrupted by
   *  another `pushUndo` before its rollback/commit (curve bend-idle's only interposer routes through
   *  here too), so it was never compacted onto `undoStack`. Restores the dirty flag and the redo
   *  stack pushUndo overwrote. Returns null when the gesture never pushed one (a selection drag, say,
   *  which touches no pixels). */
  private rollbackGestureUndo(): Snapshot | null {
    const before = this.gestureUndoState;
    this.gestureUndoState = null;
    if (!before) return null;
    const snap = this.historyPending;
    this.historyPending = null;
    this.dirty = before.dirty;
    this.redoStack = before.redo;
    return snap;
  }

  /**
   * Aborts the gesture in progress and puts the canvas back the way it was before it started - Esc
   * while dragging, or a right-click part-way through a left-button drag. Every drawing gesture takes
   * its undo snapshot up front (see pushGestureUndo), so "back the way it was" is exactly that
   * snapshot, and rolling it off the stack as well keeps a cancelled gesture out of the undo history
   * entirely rather than leaving behind a step that undoes nothing. Returns false when there was
   * nothing in flight to cancel.
   */
  cancelGesture(): boolean {
    if (!this.painting && !this.activeGesture) return false;
    const snap = this.rollbackGestureUndo();
    // Read before resetGestureState, which commits a floating move back into the frame: the snapshot
    // below then replaces those frames wholesale, so both paths land on the pre-gesture pixels.
    const sel = this.selection;
    const lasso = this.lassoPoints;
    const mask = this.selectionMask;
    this.resetGestureState();
    if (snap) {
      this.applyHistoryEntry(snap);
      // restoreSnapshot drops the selection, because an undo can change the canvas out from under it.
      // A cancelled gesture can't have - it's the same canvas it was a moment ago - so the selection
      // the user was working inside comes back rather than being collateral damage of backing out.
      this.selection = sel;
      this.lassoPoints = lasso;
      this.selectionMask = mask;
    }
    this.refresh();
    return true;
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
    } else if (this.selectionMask) {
      this.selectionMask = this.shiftMask(this.selectionMask, dx, dy);
    }
    this.refresh();
  }

  /** Translates every cell of a sparse `"x,y"` selection mask by (dx, dy) - the precise, shape-agnostic
   *  counterpart to shifting lassoPoints and re-deriving the mask via polygonMask, used by
   *  nudgeSelection/commitMove when there's no lassoPoints outline to shift instead (a Magic Wand
   *  selection whose mask couldn't be safely represented as one traced+bridged polygon - see
   *  applyMagicWandAt's own doc comment). */
  private shiftMask(mask: Set<string>, dx: number, dy: number): Set<string> {
    const shifted = new Set<string>();
    mask.forEach((key) => {
      const [xs, ys] = key.split(',');
      shifted.add(`${Number(xs) + dx},${Number(ys) + dy}`);
    });
    return shifted;
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
          const srcX = Math.floor(srcRelX + cx - origin.x0);
          const srcY = Math.floor(srcRelY + cy - origin.y0);
          // Skipped, not clamped to the edge. A destination cell in the corners of the rotated
          // bounding box maps back outside the source rectangle entirely - there is no pixel there to
          // rotate. Clamping handed those cells the nearest edge pixel instead, which smeared the
          // artwork's border outward into all four corners of the box (the more so the further from a
          // multiple of 90 degrees the angle was) and painted pixels the selection never contained.
          if (srcX < 0 || srcY < 0 || srcX >= w || srcY >= h) continue;
          const color = source[srcY][srcX];
          if (color) cells.push({ x, y, color });
        }
      }
    }
    const box: SelectionBox = bx1 >= bx0 && by1 >= by0 ? { x0: bx0, y0: by0, x1: bx1, y1: by1 } : origin;
    return { cells, box };
  }

  /**
   * The selection mask after `angle`, built the same way computeRotatePreview builds the rotated
   * pixels: walk every cell of the rotated bounding box, inverse-rotate its center back into the
   * original box, and keep it when the cell it lands on was selected. Sharing that one mapping is the
   * whole point - any independent derivation drifts from where the pixels actually went. `box` is the
   * rotated bounding box computeRotatePreview returned (already clamped to the canvas), and a plain
   * rectangular selection (no mask) counts as "every cell of rotateOrigin selected".
   */
  private rotatedSelectionMask(angle: number, box: SelectionBox): Set<string> {
    const origin = this.rotateOrigin!;
    const w = origin.x1 - origin.x0 + 1;
    const h = origin.y1 - origin.y0 + 1;
    const cx = origin.x0 + w / 2;
    const cy = origin.y0 + h / 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const source = this.selectionMask;
    const mask = new Set<string>();
    for (let y = box.y0; y <= box.y1; y++) {
      for (let x = box.x0; x <= box.x1; x++) {
        const relX = x + 0.5 - cx;
        const relY = y + 0.5 - cy;
        const srcX = Math.floor(relX * cos + relY * sin + cx);
        const srcY = Math.floor(-relX * sin + relY * cos + cy);
        if (srcX < origin.x0 || srcX > origin.x1 || srcY < origin.y0 || srcY > origin.y1) continue;
        if (source && !source.has(`${srcX},${srcY}`)) continue;
        mask.add(`${x},${y}`);
      }
    }
    return mask;
  }

  private commitRotate(): void {
    if (this.rotatePreview) {
      const frame = this.activeCells();
      const { width, height } = this.current;
      this.rotatePreview.forEach((c) => {
        if (c.x >= 0 && c.y >= 0 && c.x < width && c.y < height) frame[c.y * width + c.x] = c.color;
      });
    }
    // Re-derive the selection from the rotated *pixels* rather than rotating the shape description.
    // This used to spin each of the outline's own vertices and round them back to whole cells, which
    // at the scale a pixel-boundary outline actually has (unit-length stair steps) turned a clean
    // silhouette into a scrambled, self-crossing scribble - and left the border describing something
    // other than the pixels that had just moved. rotatedSelectionMask instead reuses the exact mapping
    // computeRotatePreview used for the pixels, so mask, outline and artwork cannot disagree.
    if (this.rotateOrigin && this.selection && this.rotateAngle !== 0) {
      this.applySelectionMask(this.rotatedSelectionMask(this.rotateAngle, this.selection), 'new');
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
    // Stays visible regardless of the active tool - a selection still constrains painting (see
    // paintPipeline.ts's `withSelectionClip`) while e.g. the Pen is active, so hiding its border there
    // would leave no way to see what's actually protected while drawing.
    // While a rotate is in flight the traced outline is hidden (it still describes the pre-rotation
    // shape - see selectionLassoOutline), so the plain box around what is being rotated stands in for
    // it and the user can still see what is turning.
    if (!this.selection || this.selectionDraft || (this.lassoPoints && !this.rotateOrigin)) return null;
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
      this.tool === 'select' && !this.rotateOrigin
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
  selectionLassoOutline(): { loops: string[] } | null {
    // Stays visible regardless of the active tool - see selectionOverlayBox's matching note. Hidden
    // for the duration of a rotate drag, though: these points describe the shape at its pre-rotation
    // angle, and re-tracing them on every pointer move would cost a full mask walk per frame for an
    // outline that is settled - correctly, from the rotated pixels themselves - the moment the drag
    // ends (see commitRotate).
    if (!this.lassoPoints || this.selectionDraft || this.rotateOrigin) return null;
    const cellPx = this.effectiveCellPx();
    const { dx, dy } = this.moveBuffer ? this.moveDelta : { dx: 0, dy: 0 };
    // No +0.5: lassoPoints are grid-line corners (see maskBoundaryEdges), so a corner maps straight to
    // the pixel edge it sits on. Adding half a cell - as this did while it assumed cell-index points,
    // the way the in-progress freehand path in lassoDraftOutline genuinely is - drew the marching ants
    // through the middle of the boundary pixels instead of around them, leaving the border visibly
    // off by half a pixel from the selection it describes.
    // One closed polygon per loop, not one path through all of them: traceMaskOutline stitches an
    // outer silhouette and its holes (or several disjoint blobs) into a single bridged point list
    // because polygonMask has to be able to rebuild the mask from it, but drawing that list as one
    // polygon also draws the bridges - a stray line cutting straight across the selection into the
    // middle of a hole, which is exactly the kind of "border that doesn't fit" this is meant to show.
    // The bridges all radiate from one hub point (see traceMaskOutline), so splitting the list wherever
    // it returns to that hub hands back the original loops - a boundary vertex belongs to exactly one
    // loop, so no loop can pass back through the hub by coincidence.
    const hub = this.lassoPoints[0];
    const loops: string[] = [];
    let current: string[] = [];
    this.lassoPoints.forEach((p, i) => {
      if (i > 0 && p.x === hub.x && p.y === hub.y) {
        if (current.length > 1) loops.push(current.join(' '));
        current = [];
        return;
      }
      current.push(`${(p.x + dx) * cellPx},${(p.y + dy) * cellPx}`);
    });
    if (current.length > 1) loops.push(current.join(' '));
    return loops.length ? { loops } : null;
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
    this.stopGestureTimer();
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
    this.stopGestureTimer();
    this.commitRotate();
    this.refresh();
  }

  // --- new Tool/Gesture architecture (src/lib/tools/) - see that directory's ARCHITECTURE.md ---

  /** Builds the read-only snapshot a migrated tool's gesture logic reads - see ToolContext's own doc
   *  comment for why this is a plain data bag instead of `this`. */
  private buildToolContext(): ToolContext {
    const { width, height } = this.current;
    const frame = this.activeCells();
    return {
      width,
      height,
      getCell: (x, y) => (x >= 0 && y >= 0 && x < width && y < height ? frame[y * width + x] : null),
      color: this.color,
      secondaryColor: this.gradientColor,
      brushSize: this.brushSize,
      ditherEnabled: this.ditherEnabled,
      gradientType: this.gradientType,
      pixelPerfect: this.pixelPerfect,
      shapeFilled: this.shapeFilled,
      symmetry: this.symmetry,
      symmetryAxisX: this.symmetryAxisX,
      symmetryAxisY: this.symmetryAxisY,
      selection: this.selection,
      selectionMask: this.selectionMask,
      fillTolerance: this.fillTolerance,
      wandContiguous: this.wandContiguous,
      selectionMode: this.selectionMode,
      getVisibleColor: (x, y) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return null;
        const layers = this.layers();
        for (let i = layers.length - 1; i >= 0; i--) {
          if (!layers[i].visible) continue;
          const sampled = layers[i].cells[y * width + x];
          if (sampled) return sampled;
        }
        return null;
      },
      sprayDensity: this.sprayDensity,
    };
  }

  /** Resolves a raw DOM pointer event into the tool-agnostic shape Gesture methods read. Always the
   *  *unclamped* cell (see cellFromEventUnclamped's own doc comment) - Pen needs it to keep painting a
   *  stroke that runs off the edge, Move needs it to drag a selection past the canvas boundary, and
   *  it's harmless for the other migrated tools (their own commit logic bounds-checks). */
  private toolPointerEvent(e: { clientX: number; clientY: number; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean; button: number }): ToolPointerEvent {
    const cell = this.cellFromEventUnclamped(e);
    const chainFrom = (this.tool === 'pen' || this.tool === 'eraser') && e.shiftKey ? this.strokeChainAnchor() : null;
    return { cell, shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.ctrlKey || e.metaKey, button: e.button, chainFrom };
  }

  /** Starts a migrated tool's gesture: pushes the undo snapshot (skipped for NO_UNDO_TOOLS, which never
   *  touch a pixel - see `rollbackGestureUndo`'s "returns null when the gesture never pushed one" case
   *  for why that's safe to just skip rather than push-then-always-rollback), then immediately replays
   *  the same event through `onPointerMove` once - every tool's original behavior painted/previewed
   *  immediately on mousedown, not just starting from the first pointermove. */
  private beginToolGesture(tool: Tool, tpe: ToolPointerEvent): void {
    if (!NO_UNDO_TOOLS.has(tool.name)) this.pushGestureUndo();
    this.painting = true;
    const ctx = this.buildToolContext();
    const gesture = tool.beginGesture(tpe, ctx);
    if (!gesture) {
      this.rollbackGestureUndo();
      this.painting = false;
      return;
    }
    this.activeGesture = gesture;
    this.lastToolPointerEvent = tpe;
    if (gesture.onTick) this.startGestureTimer();
    this.applyToolPreview(gesture.onPointerMove(tpe, ctx));
  }

  /** Applies one ToolPreview - ports the same three destinations the legacy code wrote a live preview
   *  to, now driven by data instead of each tool's own inline calls: committed cells go straight into
   *  the frame (Pen), an overlay repaints via the existing `redrawRegions` (shapes), and Move's
   *  floating-buffer state feeds the existing `gestureBaseBitmap` fast path unchanged. */
  private applyToolPreview(preview: ToolPreview | null): void {
    if (!preview) return;
    if (preview.curvePreview) {
      this.curvePhase = preview.curvePreview.phase;
      this.curveControl = preview.curvePreview.control;
    }
    if (preview.ops && preview.ops.length) {
      const { width, height } = this.current;
      const frame = this.activeCells();
      preview.ops.forEach((op) => {
        if (op.x >= 0 && op.y >= 0 && op.x < width && op.y < height) frame[op.y * width + op.x] = op.color;
      });
    }
    if (preview.selectionDraft !== undefined) {
      // Select's live marquee - pure metadata (PixelSelectionOverlay.tsx reads `selectionDraft`
      // directly), never touches the canvas bitmap, so only a React re-render is needed - matches the
      // original's own `reactNotify(), not refresh()` reasoning (usePixelEditor.ts:2891-2895 pre-
      // migration).
      this.selectionDraft = preview.selectionDraft;
      this.reactNotify();
      return;
    }
    if (preview.lassoDraftPoints !== undefined) {
      // Lasso's live freeform path - same reasoning as selectionDraft above.
      this.lassoDraftPoints = preview.lassoDraftPoints;
      this.reactNotify();
      return;
    }
    if (preview.movePreview) {
      this.moveBuffer = { cells: preview.movePreview.cells.map((c) => ({ x: c.x, y: c.y, color: c.color })) };
      this.moveDelta = { dx: preview.movePreview.dx, dy: preview.movePreview.dy };
      if (!this.gestureBaseBitmap) this.cacheGestureBaseBitmap();
      this.lastGesturePreviewRects = null;
      this.refresh();
      return;
    }
    if (preview.gradientPreview) {
      // Mirror into the legacy engine fields so the existing, unchanged drawGradientPreviewOverlay()
      // keeps rendering the live drag with the canvas's own native ctx.createLinearGradient - same
      // "mirror data into legacy fields for legacy rendering" trick as movePreview above.
      const { start, end, eraseOverride } = preview.gradientPreview;
      this.gradientStart = start;
      this.gradientEnd = end;
      this.eraseOverride = eraseOverride;
      this.drawGradientPreviewOverlay();
      return;
    }
    if (preview.dirtyRects.length) {
      this.redrawRegions(preview.dirtyRects, preview.overlay ?? undefined);
      this.lastGesturePreviewRects = preview.overlay ? preview.dirtyRects : null;
    } else if (preview.ops && preview.ops.length) {
      this.reactNotify();
    }
  }

  /** Finalizes a migrated tool's gesture on release - the counterpart to every legacy tool's own
   *  onPointerUp commit branch (shape commit at usePixelEditor.ts:2871-2892, commitMove, etc.),
   *  generalized: write `ops` into the frame, apply any selection change, then either roll back the
   *  undo entry (nothing changed) or repaint. */
  private commitGestureResult(result: GestureResult): void {
    const { width, height } = this.current;
    const frame = this.activeCells();
    result.ops.forEach((op) => {
      if (op.x >= 0 && op.y >= 0 && op.x < width && op.y < height) frame[op.y * width + op.x] = op.color;
    });
    if (result.keepActive) {
      // Curve only: a PHASE TRANSITION (drag-end -> bend), not the gesture's real end - apply any ops
      // (curve has none at this point, but stay generic) and show the new phase's overlay immediately,
      // without touching the undo stack or clearing activeGesture/lastToolPointerEvent. A later
      // onResumeDown/onKeyDown result that omits `keepActive` is what actually finishes the gesture.
      if (result.curvePreview) {
        this.curvePhase = result.curvePreview.phase;
        this.curveControl = result.curvePreview.control;
      }
      if (result.overlay !== undefined) {
        this.redrawRegions(result.dirtyRects, result.overlay ?? undefined);
        this.lastGesturePreviewRects = result.overlay ? result.dirtyRects : null;
      } else {
        // No canvas repaint needed (e.g. releasing after a control-handle drag reuses the bezier
        // already drawn by the last onPointerMove) - still need a React render so the DOM-drawn control
        // handle (PixelSelectionOverlay.tsx) picks up curvePhase/curveControl's new values above.
        this.reactNotify();
      }
      return;
    }
    if (result.selection) {
      this.selection = result.selection.box;
      this.selectionMask = result.selection.mask ? new Set(result.selection.mask) : null;
      this.lassoPoints = result.selection.outline;
    }
    if (result.pickedColor !== undefined) {
      this.color = result.pickedColor;
      if (result.switchToPen) this.tool = 'pen';
    }
    if (result.alsoSaveColor !== undefined) this.addSavedColor(result.alsoSaveColor);
    const wasMove = result.moveSelectionBy !== undefined;
    if (result.moveSelectionBy) {
      const { dx, dy } = result.moveSelectionBy;
      if (this.selection) this.selection = shiftBox(this.selection, { dx, dy });
      if (this.lassoPoints) {
        this.lassoPoints = this.lassoPoints.map((p) => ({ x: p.x + dx, y: p.y + dy }));
        this.selectionMask = this.polygonMask(this.lassoPoints);
      } else if (this.selectionMask) {
        this.selectionMask = this.shiftMask(this.selectionMask, dx, dy);
      }
    }
    const hadColor = result.ops.some((op) => op.color !== null);
    this.moveBuffer = null;
    this.moveDelta = { dx: 0, dy: 0 };
    this.gestureBaseBitmap = null;
    this.lastGesturePreviewRects = null;
    this.selectionDraft = null;
    this.lassoDraftPoints = null;
    this.eraseOverride = false;
    this.curvePhase = null;
    this.curveControl = null;
    this.activeGesture = null;
    this.lastToolPointerEvent = null;

    if (!result.changed) {
      this.rollbackGestureUndo();
      // Still repaint any dirty rects even though nothing "counts" as a change - a tool whose live
      // preview draws unclipped (every shape tool's overlay ignores the selection, only the commit
      // filters by it) can end a drag with zero real ops (e.g. dragged entirely outside the active
      // selection) while its overlay is still sitting on the canvas bitmap; skipping this repaint would
      // leave that overlay stranded on screen. Harmless when there's nothing to erase (dirtyRects empty)
      // or the repainted cells are unchanged (e.g. Fill's same-color no-op).
      if (result.dirtyRects.length) this.redrawRegions(result.dirtyRects);
      else this.reactNotify();
      return;
    }
    if (hadColor && !wasMove) this.addSavedColor(this.color);
    if (result.finalCell && (this.tool === 'pen' || this.tool === 'eraser')) this.lastStrokeEndCell = result.finalCell;
    if (wasMove) {
      this.refresh();
    } else if (result.dirtyRects.length) {
      this.redrawRegions(result.dirtyRects);
    } else {
      this.flushPreviewRepaint();
      this.reactNotify();
    }
  }

  onPointerDown(e: React.PointerEvent<HTMLCanvasElement>): void {
    // Middle-button pan (Paint/Photoshop/Pixilart convention): works regardless of the active tool and
    // independent of `painting`/tool-specific state entirely, so it can't trigger a draw action and
    // doesn't care what a concurrent primary-button gesture is doing. preventDefault suppresses the
    // browser's own middle-click autoscroll mode, which would otherwise also arm on this same event.
    if (e.button === 1 || (e.button === 0 && this.spacePanActive)) {
      e.preventDefault();
      this.middlePanActive = true;
      this.middlePanLast = { x: e.clientX, y: e.clientY };
      if (this.canvas) this.canvas.style.cursor = 'grabbing';
      this.canvas?.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button === 2 && !ERASABLE_TOOLS.has(this.tool)) return;
    // Which buttons this gesture began with, so onPointerMove can tell a *newly* pressed one from the
    // one already holding the drag together - see its second-button check.
    this.gestureButtons = e.buttons;

    const cell = this.cellFromEvent(e);
    if (!cell) return;
    if (this.painting) this.resetGestureState();
    this.canvas?.setPointerCapture(e.pointerId);

    if (e.altKey && ALT_PICK_TOOLS.has(this.tool)) {
      this.pickColor(cell.x, cell.y, false);
      return;
    }

    // Curve only: a further pointerdown while its gesture is still active (`keepActive` kept it alive
    // across the drag-end -> bend transition, so `this.painting` is false but `activeGesture` isn't
    // null) - either resumes dragging the control handle or commits, depending on where this click
    // landed. Must run before TOOL_REGISTRY dispatch below, or this would start a brand new curve
    // gesture instead of resuming the pending one.
    if (this.activeGesture?.onResumeDown) {
      const tpe = this.toolPointerEvent(e);
      const outcome = this.activeGesture.onResumeDown(tpe, this.buildToolContext(), this.isNearCurveControl(e));
      if ('preview' in outcome) {
        this.painting = true;
        this.lastToolPointerEvent = tpe;
        this.applyToolPreview(outcome.preview);
      } else {
        this.commitGestureResult(outcome.result);
      }
      return;
    }

    // Migrated tools (see TOOL_REGISTRY). Magic Wand keeps its original routing quirk: a click that
    // resolves to 'subtract' always subtracts, even inside the existing selection, but any other
    // click landing inside it starts a Move instead (see resolveWandCombine's own doc comment and the
    // original usePixelEditor.ts:2699-2707 this ports).
    if (this.tool === 'magicWand') {
      const tpe = this.toolPointerEvent(e);
      const combine = resolveWandCombine(tpe, this.selectionMode);
      if (combine !== 'subtract' && this.isInsideSelection(cell)) {
        this.beginToolGesture(TOOL_REGISTRY.move!, tpe);
        return;
      }
      this.beginToolGesture(TOOL_REGISTRY.magicWand!, tpe);
      return;
    }
    // Select/Lasso share one routing rule (different from Magic Wand's above): only a click that
    // resolves to 'new' AND lands inside the existing selection starts a Move - 'add'/'subtract'
    // always start a fresh marquee/lasso drag instead, even from inside the selection (see
    // resolveMarqueeMode's own doc comment and the original usePixelEditor.ts:2710-2738 this ports).
    if (this.tool === 'select' || this.tool === 'lasso') {
      const tpe = this.toolPointerEvent(e);
      const mode = resolveMarqueeMode(tpe, this.selectionMode);
      if (mode === 'new' && this.isInsideSelection(cell)) {
        this.beginToolGesture(TOOL_REGISTRY.move!, tpe);
        return;
      }
      this.beginToolGesture(TOOL_REGISTRY[this.tool]!, tpe);
      return;
    }
    const registryTool = TOOL_REGISTRY[this.tool];
    if (registryTool) {
      this.beginToolGesture(registryTool, this.toolPointerEvent(e));
      return;
    }
    // Every ToolName reaches a `return` above this point: select/lasso are handled inline, and every
    // other tool (pen, eraser, rect, ellipse, line, magicWand, move, eyedropper, fill, gradient, spray,
    // curve) is dispatched through TOOL_REGISTRY (curve's resumed-gesture case is intercepted earlier,
    // above, before this dispatch). Nothing falls through to here.
  }

  /** lastStrokeEndCell, but only when it still points at a cell this canvas actually has - a resize,
   *  trim or sprite load can leave it outside. */
  private strokeChainAnchor(): Cell | null {
    const a = this.lastStrokeEndCell;
    if (!a || this.tool !== 'pen' && this.tool !== 'eraser') return null;
    const { width, height } = this.current;
    return a.x >= 0 && a.y >= 0 && a.x < width && a.y < height ? a : null;
  }

  onPointerMove(e: React.PointerEvent<HTMLCanvasElement>): void {
    if (this.middlePanActive) {
      if (!this.middlePanLast) return;
      const dx = e.clientX - this.middlePanLast.x;
      const dy = e.clientY - this.middlePanLast.y;
      this.middlePanLast = { x: e.clientX, y: e.clientY };
      // A Photoshop-style hand-drag: moves 1:1 with the mouse, stopping only at clampPan's edge margin
      // so the canvas can't be dragged out of sight entirely. panBy writes the transform straight to
      // the DOM (no React render per pointermove) - see applyPanToDom.
      this.panBy(dx, dy);
      return;
    }
    // A second mouse button pressed part-way through a drag aborts it (the Paint/Aseprite convention),
    // rather than the drag carrying on regardless and committing whatever it had. This has to be caught
    // here and not in onPointerDown: a pointerdown fires only for the *first* button of a press, and
    // pressing another one while the pointer is already down arrives as an ordinary pointermove with an
    // extra bit set in `buttons` - there is no second pointerdown to hook.
    if (this.painting && (e.buttons & ~this.gestureButtons & 0b111) !== 0) {
      this.cancelGesture();
      return;
    }
    if (this.activeGesture) {
      // Coalesced replay only for Pen/Eraser, same as the legacy pen branch below (see its own doc
      // comment) - the other migrated tools (shape preview, Move) only ever read the final position of
      // a move batch, so replaying every coalesced sample would just be wasted repaints for them.
      const isPenLike = this.tool === 'pen' || this.tool === 'eraser';
      const coalesced = isPenLike && typeof e.nativeEvent.getCoalescedEvents === 'function' ? e.nativeEvent.getCoalescedEvents() : [];
      const positions = coalesced.length > 1 ? coalesced : [e];
      const ctx = this.buildToolContext();
      positions.forEach((pos) => {
        // clientX/clientY are read explicitly, never spread: on a *native* DOM PointerEvent (which is
        // what getCoalescedEvents returns, unlike the React synthetic event `e`) they are prototype
        // getters, not own enumerable properties, so `{ ...pos }` silently drops them - leaving
        // cellFromEventUnclamped to compute NaN cells, which then hung bresenhamLine's loop outright.
        // Modifier keys come from the outer React event: only the position varies between samples.
        const tpe = this.toolPointerEvent({
          clientX: pos.clientX,
          clientY: pos.clientY,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          button: e.button,
        });
        this.lastToolPointerEvent = tpe;
        this.applyToolPreview(this.activeGesture!.onPointerMove(tpe, ctx));
      });
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
    // Every drawing tool is migrated (see TOOL_REGISTRY / src/lib/tools): a live pen/eraser stroke
    // runs entirely through `this.activeGesture` above. Nothing reaches here painting - a `select`
    // resize/rotate drag is the only way to be `painting` without an `activeGesture`, and it has
    // nothing to do on pointermove (the DOM handles drive it).
  }

  onPointerUp(): void {
    if (this.middlePanActive) {
      this.middlePanActive = false;
      this.middlePanLast = null;
      if (this.canvas) this.canvas.style.cursor = this.spacePanActive ? 'grab' : '';
      return;
    }
    if (!this.painting) return;
    this.painting = false;
    this.gestureButtons = 0;
    this.stopGestureTimer();

    if (this.activeGesture) {
      // The real DOM pointerup carries no position (see this method's own empty signature) - finalize
      // using the last position `onPointerMove` saw instead of re-deriving one.
      const tpe = this.lastToolPointerEvent ?? { cell: { x: 0, y: 0 }, shiftKey: false, altKey: false, ctrlKey: false, button: 0 };
      this.commitGestureResult(this.activeGesture.onPointerUp(tpe, this.buildToolContext()));
      return;
    }

    // Only reachable for a `select` resize/rotate drag (painting, but no `activeGesture`) - every
    // drawing tool commits through `activeGesture` above. Nothing here touches a pixel; the deferred
    // preview repaint that schedulePreviewRepaint() skips mid-stroke on a large sprite gets to run.
    this.eraseOverride = false;
    this.flushPreviewRepaint();
    this.reactNotify();
  }

  /**
   * Blends startColor -> endColor across the selection (or the whole canvas with none) along the
   * start/end axis: each cell's position is projected onto that axis and clamped to [0,1]. A
   * right-click reverses which color sits at which end, reusing eraseOverride as a swap flag.
   */
  /**
   * Live drag preview for the gradient tool: paints the box directly with the canvas's own native
   * (GPU-composited) linear gradient instead of computing a per-cell color array and painting it cell by
   * cell every frame (see gradientTool.ts's `gradientCellsPreviewOps`, still used for the commit - but
   * only once, on release, see GradientGesture.onPointerUp). Called from applyToolPreview's
   * `gradientPreview` branch, which mirrors the live drag's start/end/eraseOverride into this class's own
   * fields first (same "mirror into legacy fields for legacy rendering" trick as Move's moveBuffer).
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
   * the same clamp-to-end-stop behavior as gradientCellsPreviewOps's `Math.min(1, Math.max(0, t))` for
   * points beyond the start/end axis natively - the one case it doesn't match is a zero-length axis
   * (start === end, e.g. right on mousedown before any drag), which paints nothing at all rather than a
   * solid color, so that case is special-cased to match gradientCellsPreviewOps's own `t = 0.5` default.
   *
   * When dither mode is on, the smooth native gradient above would be a lie - the actual commit (see
   * gradientCellsPreviewOps, called from GradientGesture.onPointerUp) is a per-cell Bayer-dithered
   * stipple, not a blend, so this falls back to painting per-cell with the same ditherColorAt() call
   * instead, trading the native gradient's speed for a preview that matches what dragging actually
   * produces.
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
    const radial = this.gradientType === 'radial';
    if (this.ditherEnabled) {
      for (let y = box.y0; y <= box.y1; y++) {
        for (let x = box.x0; x <= box.x1; x++) {
          const t = gradientT(x, y, this.gradientStart, this.gradientEnd, this.gradientType);
          ctx.fillStyle = ditherColorAt(x, y, startColor, endColor, ditherGradientMix(t));
          ctx.fillRect(x, y, 1, 1);
        }
      }
    } else if (dx === 0 && dy === 0) {
      const [sr, sg, sb] = hexToRgb(startColor);
      const [er, eg, eb] = hexToRgb(endColor);
      ctx.fillStyle = rgbToHex((sr + er) / 2, (sg + eg) / 2, (sb + eb) / 2);
      ctx.fillRect(box.x0, box.y0, w, h);
    } else {
      const cx = this.gradientStart.x + 0.5;
      const cy = this.gradientStart.y + 0.5;
      const gradient = radial
        ? ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(dx, dy))
        : ctx.createLinearGradient(cx, cy, this.gradientEnd.x + 0.5, this.gradientEnd.y + 0.5);
      gradient.addColorStop(0, startColor);
      gradient.addColorStop(1, endColor);
      ctx.fillStyle = gradient;
      ctx.fillRect(box.x0, box.y0, w, h);
    }
    ctx.restore();
    this.reactNotify();
  }

  /** Drops any pending curve gesture without a refresh - for use inside other state-resetting methods
   *  (switching frames, pushing a new undo step, sprite load/resize/reset) that will refresh themselves.
   *  Curve is the only tool that can be "active but not painting" (bend-idle, kept alive via
   *  `GestureResult.keepActive`) at a point where one of these unrelated actions might fire, so this is
   *  a no-op for every other tool. Also rolls back the undo entry curve's drag-end start pushed - the
   *  original left that orphaned on the stack instead (a latent bug: an abandoned curve draft never
   *  wrote real pixels, so restoring it would be a no-op anyway, but it still wasted an undo slot and
   *  falsely marked the sprite dirty / cleared the redo stack) - fixed for free here by routing through
   *  the same `rollbackGestureUndo()` every other cancelled gesture already uses. */
  private clearCurveState(): void {
    if (!this.activeGesture) return;
    this.activeGesture.onCancel(this.buildToolContext());
    this.activeGesture = null;
    this.lastToolPointerEvent = null;
    this.curvePhase = null;
    this.curveControl = null;
    this.rollbackGestureUndo();
  }

  /** Starts ticking the active migrated tool's `Gesture.onTick` (currently only Spray) on a fixed
   *  interval, independent of pointer movement - ports `startSprayTimer`/`sprayTick`'s wall-clock-timer
   *  role generically, so any future timer-driven tool needs no engine changes, just `onTick`. */
  private startGestureTimer(): void {
    if (this.gestureTimer) clearInterval(this.gestureTimer);
    this.gestureTimer = setInterval(() => {
      if (!this.activeGesture?.onTick) return;
      this.applyToolPreview(this.activeGesture.onTick(this.buildToolContext()));
    }, SPRAY_INTERVAL_MS);
  }

  private stopGestureTimer(): void {
    if (this.gestureTimer) {
      clearInterval(this.gestureTimer);
      this.gestureTimer = null;
    }
  }

  /**
   * Redraws only `rects` of the canvas instead of the whole thing, for paths where drawGrid()'s usual
   * full clear+repaint was the actual measured bottleneck on a large, detailed canvas: profiling a
   * 1400×900 canvas with content that defeats paintFrameCells' run-length merging (no long same-color
   * runs - a real, not contrived, case for detailed pixel art) measured a full redraw at ~590ms per
   * layer, so every pointer move during a stroke or a tool preview was gated on hundreds of
   * milliseconds of work regardless of how small the actual change was. Both only ever touch a small,
   * boundable area, so bounding the repaint
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
      this.paintOnionSkin(ctx, r);
      paintLayers(ctx, this.current.frames[this.frameIndex], width, height, 1, 1, r);
    });
    if (overlay) {
      ctx.fillStyle = overlay.color;
      overlay.cells.forEach((c) => {
        if (c.x >= 0 && c.y >= 0 && c.x < width && c.y < height) ctx.fillRect(c.x, c.y, 1, 1);
      });
    }
    this.schedulePreviewRepaint();
    this.reactNotify();
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

  // colorsMatch (the fuzzy tolerance-aware color comparison Fill/Magic Wand both need) now lives as a
  // pure function duplicated in fillTool.ts and magicWandTool.ts, ported alongside those tools.

  // floodFill/globalReplace (the Fill tool's own flood/global-replace algorithms) now live as pure
  // functions in src/lib/tools/tools/fillTool.ts, ported alongside the rest of that tool.

  // floodSelectMask/globalSelectMask (Magic Wand's own tolerance-aware region walk) now live as pure
  // functions in src/lib/tools/tools/magicWandTool.ts, ported alongside the rest of that tool.

  /** Materializes whatever the current selection is (a plain rectangular box with no mask, or an
   *  already-sparse mask) into an explicit `"x,y"` cell set - what Magic Wand's Ctrl/Alt combine modes
   *  need as their starting point, since a plain marquee selection has no mask of its own to union or
   *  subtract against. */
  private maskFromSelection(): Set<string> {
    if (this.selectionMask) return new Set(this.selectionMask);
    const mask = new Set<string>();
    if (!this.selection) return mask;
    const { x0, y0, x1, y1 } = this.selection;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) mask.add(`${x},${y}`);
    return mask;
  }

  /** Bounding box of a sparse `"x,y"` cell mask (see selectionMask) - the Magic Wand's counterpart to
   *  boundingBoxOfPoints, used the same way: as the settled selection's `selection` box. */
  private boundingBoxOfMask(mask: Set<string>): SelectionBox {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    mask.forEach((key) => {
      const [xs, ys] = key.split(',');
      const x = Number(xs);
      const y = Number(ys);
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    });
    return { x0, y0, x1, y1 };
  }

  /**
   * Every unit boundary edge of a cell mask, in grid-line coordinates (0..width/height - the corner
   * where cell (x,y)'s own corners sit, not a cell index) rather than cell coordinates: polygonMask
   * decides whether cell (x,y) is selected by checking whether its *center* (x+0.5, y+0.5) falls
   * inside the traced polygon, so a polygon built from cell coordinates directly (as if the boundary
   * cells themselves were the vertices) ends up exactly one cell short on the far/bottom side of
   * whatever it encloses - confirmed by tracing a plain 2x2 block that way and finding polygonMask
   * reconstructs only 1 of the 4 cells. Emitting the actual grid-line corner each boundary side sits
   * on (one cell over from the boundary cell itself, on the appropriate side) is what makes
   * polygonMask reconstruct the exact original mask - verified the same way, this time getting all 4
   * cells back. selectionLassoOutline renders these points as-is, with no half-cell offset, so the
   * border drawn from them sits exactly on the boundary pixels' outer edges.
   */
  private maskBoundaryEdges(mask: Set<string>): { from: Cell; to: Cell }[] {
    const edges: { from: Cell; to: Cell }[] = [];
    mask.forEach((key) => {
      const [xs, ys] = key.split(',');
      const x = Number(xs);
      const y = Number(ys);
      if (!mask.has(`${x},${y - 1}`)) edges.push({ from: { x, y }, to: { x: x + 1, y } });
      if (!mask.has(`${x + 1},${y}`)) edges.push({ from: { x: x + 1, y }, to: { x: x + 1, y: y + 1 } });
      if (!mask.has(`${x},${y + 1}`)) edges.push({ from: { x: x + 1, y: y + 1 }, to: { x, y: y + 1 } });
      if (!mask.has(`${x - 1},${y}`)) edges.push({ from: { x, y: y + 1 }, to: { x, y } });
    });
    return edges;
  }

  /**
   * Chains maskBoundaryEdges' unordered edge soup into closed loops by following each edge's `to`
   * point to the next edge that starts there. Every vertex on a raster mask's boundary has exactly one
   * outgoing and one incoming edge by construction (each grid-line segment is the border of exactly
   * one boundary cell on the selected side), so this always resolves into whole simple closed loops
   * with nothing left over: one per outer silhouette, and - for free, needing no special-casing - one
   * per interior hole, automatically wound the opposite way round (an unselected cell's neighbors emit
   * their shared edges in the mirror-image direction of an outer boundary), which is exactly what lets
   * an even-odd fill (see polygonMask) or the default nonzero SVG fill rule render/reconstruct a hole
   * as a hole rather than filled-in.
   */
  private chainBoundaryEdges(edges: { from: Cell; to: Cell }[]): Cell[][] {
    const byStart = new Map<string, { from: Cell; to: Cell }[]>();
    edges.forEach((e) => {
      const key = `${e.from.x},${e.from.y}`;
      const list = byStart.get(key);
      if (list) list.push(e);
      else byStart.set(key, [e]);
    });
    const used = new Set<{ from: Cell; to: Cell }>();
    const loops: Cell[][] = [];
    edges.forEach((start) => {
      if (used.has(start)) return;
      const loop: Cell[] = [];
      let current = start;
      while (!used.has(current)) {
        used.add(current);
        loop.push(current.from);
        const candidates = byStart.get(`${current.to.x},${current.to.y}`) ?? [];
        const next = candidates.find((e) => !used.has(e));
        if (!next) break;
        current = next;
      }
      loops.push(loop);
    });
    return loops;
  }

  /**
   * Combines every boundary loop (see chainBoundaryEdges - an outer silhouette plus any holes, or
   * several disjoint loops for a global Shift+click match spanning multiple blobs) into the single
   * closed point list lassoPoints expects. A single loop is used as-is; two or more are stitched into
   * one path via "keyhole" bridges radiating from the first loop's own start point (the "hub"): each
   * other loop is spliced in as its own closed lap, entered and exited through the exact same hub
   * point (bridging every extra loop through one shared hub, rather than threading loop 1 -> 2 -> 3 ->
   * ... -> back to 1, is what makes this generalize to any number of loops instead of just two).
   *
   * In principle a bridge edge, walked once out and once back, contributes either zero or two
   * scanline crossings at any given y in polygonMask's even-odd count, which cancels out and renders
   * as an invisible zero-width seam - and that holds up whenever the bridge only ever passes through
   * rows where the real geometry it's bridging also has crossings of its own (true for a hole, always
   * inside its own outer loop's row span). It does NOT reliably hold for two loops separated by rows
   * neither one touches (a global Shift+click match spanning genuinely disjoint blobs): the bridge's
   * pair of identical, coincident crossings on an otherwise-empty row can misround into a spurious
   * 1-cell-wide sliver (confirmed by reconstructing a two-disjoint-2x2-blocks case this way and getting
   * 11 cells back instead of 8). applyMagicWandAt verifies the round trip and discards this outline
   * rather than risk that, so this function itself doesn't need to tell the safe and unsafe cases apart.
   */
  private traceMaskOutline(mask: Set<string>): Cell[] {
    const loops = this.chainBoundaryEdges(this.maskBoundaryEdges(mask)).filter((loop) => loop.length > 0);
    if (loops.length <= 1) return loops[0] ?? [];
    const hub = loops[0][0];
    const path: Cell[] = [...loops[0], hub];
    for (let i = 1; i < loops.length; i++) path.push(...loops[i], loops[i][0], hub);
    return path;
  }

  private masksEqual(a: Set<string>, b: Set<string>): boolean {
    if (a.size !== b.size) return false;
    for (const key of a) if (!b.has(key)) return false;
    return true;
  }

  /** Merges a freshly made selection mask into whatever is already selected per `mode`, then settles
   *  the result into the selection box / mask / outline trio the overlay and every selection-aware
   *  operation read. Shared by the Magic Wand, the lasso and (in add/subtract mode) the rectangular
   *  marquee, so "add to the selection" means the same thing and produces the same kind of selection
   *  whichever tool drew the new piece. */
  private applySelectionMask(clicked: Set<string>, mode: SelectionMode): void {
    let mask: Set<string>;
    if (mode === 'add') {
      mask = this.maskFromSelection();
      clicked.forEach((key) => mask.add(key));
    } else if (mode === 'subtract') {
      mask = this.maskFromSelection();
      clicked.forEach((key) => mask.delete(key));
    } else {
      mask = clicked;
    }

    if (mask.size === 0) {
      this.selection = null;
      this.lassoPoints = null;
      this.selectionMask = null;
      return;
    }
    const box = this.boundingBoxOfMask(mask);
    this.selection = box;
    // A mask that fills its own bounding box completely *is* a plain rectangular marquee, so it is
    // stored as one: no per-cell mask to carry around, and the resize handles (which only render for a
    // rectangle - see selectionOverlayBox) stay available. Rotating a rectangle by a multiple of 90
    // degrees lands here, as does a Magic Wand click on a rectangular block of color.
    if (mask.size === (box.x1 - box.x0 + 1) * (box.y1 - box.y0 + 1)) {
      this.selectionMask = null;
      this.lassoPoints = null;
      return;
    }
    this.selectionMask = mask;
    const outline = this.traceMaskOutline(mask);
    this.lassoPoints = outline.length > 0 && this.masksEqual(this.polygonMask(outline), mask) ? outline : null;
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
  /** Composites one onion-skin frame onto the reused onionBitmap scratch canvas and blits it onto
   *  `targetCtx` at `alpha`. `tintColor` recolors it first (via 'source-atop', which only touches
   *  already-opaque pixels, leaving transparent ones transparent) - null keeps the frame's own colors,
   *  for onionColorMode 'original'. `region` (canvas cell coords) restricts the blit to that
   *  sub-rectangle, same as paintLayers' own `region` param, for redrawRegions' scoped repaints. */
  private paintTintedOnion(
    targetCtx: CanvasRenderingContext2D,
    layers: Layer[],
    width: number,
    height: number,
    alpha: number,
    tintColor: string | null,
    region?: SelectionBox
  ): void {
    if (!this.onionBitmap) this.onionBitmap = document.createElement('canvas');
    const bmp = this.onionBitmap;
    if (bmp.width !== width || bmp.height !== height) {
      bmp.width = width;
      bmp.height = height;
    }
    const bctx = bmp.getContext('2d')!;
    bctx.clearRect(0, 0, width, height);
    paintLayers(bctx, layers, width, height, 1);
    if (tintColor) {
      bctx.globalCompositeOperation = 'source-atop';
      bctx.fillStyle = tintColor;
      bctx.fillRect(0, 0, width, height);
      bctx.globalCompositeOperation = 'source-over';
    }
    targetCtx.save();
    targetCtx.globalAlpha = alpha;
    if (region) {
      const w = region.x1 - region.x0 + 1;
      const h = region.y1 - region.y0 + 1;
      targetCtx.drawImage(bmp, region.x0, region.y0, w, h, region.x0, region.y0, w, h);
    } else {
      targetCtx.drawImage(bmp, 0, 0);
    }
    targetCtx.restore();
  }

  /**
   * Onion skin: onionBefore frames before the active one and onionAfter frames after it, each one
   * proportionally fainter the further away it is (onionOpacity / distance), tinted red/blue by
   * direction unless onionColorMode says otherwise. Skipped entirely when onionSkin is off or there's
   * only one frame to begin with. `region` threads through to redrawRegions' scoped repaints the same
   * way paintLayers' own `region` param does.
   *
   * The frames are resolved into a map keyed by frame index *before* anything is painted, for two
   * reasons. Frames wrap, so on a short sprite the same frame can be reached in both directions (on a
   * 2-frame sprite, "the previous frame" and "the next frame" are the same one) - painting it once per
   * direction stacked two tints into a muddy purple at double the intended alpha, which is most of why
   * onion skin read as "only showing one side". And the map lets the nearest occurrence win, so a
   * frame's tint always reflects its shortest distance from the active one. Painting then runs
   * farthest-first so nearer frames land on top.
   */
  private paintOnionSkin(ctx: CanvasRenderingContext2D, region?: SelectionBox): void {
    if (!this.onionSkin) return;
    const total = this.current.frames.length;
    if (total <= 1) return;
    const { width, height } = this.current;

    const shown = new Map<number, { distance: number; tint: string }>();
    const consider = (idx: number, distance: number, tint: string) => {
      if (idx === this.frameIndex) return;
      const existing = shown.get(idx);
      if (existing && existing.distance <= distance) return;
      shown.set(idx, { distance, tint });
    };
    // "Before" first, so a frame reachable at the same distance in both directions keeps the
    // before-tint - the direction people actually mean when a 2-frame sprite makes the two identical.
    for (let d = 1; d <= this.onionBefore; d++) consider(((this.frameIndex - d) % total + total) % total, d, ONION_TINT_BEFORE);
    for (let d = 1; d <= this.onionAfter; d++) consider((this.frameIndex + d) % total, d, ONION_TINT_AFTER);

    [...shown.entries()]
      .sort((a, b) => b[1].distance - a[1].distance)
      .forEach(([idx, { distance, tint }]) => {
        const alpha = Math.min(1, this.onionOpacity / distance);
        const color = this.onionColorMode === 'tint' ? tint : null;
        this.paintTintedOnion(ctx, this.current.frames[idx], width, height, alpha, color, region);
      });
  }

  drawGrid(overlayCells?: Cell[]): void {
    if (!this.canvas || !this.ctx) return;
    const { width, height } = this.current;
    const canvas = this.canvas;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    this.paintOnionSkin(ctx);

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
    // paintPreview(), not tickPreview(): restarting the timer (changing speed, adding a frame, loading
    // a sprite) shouldn't itself advance the animation by one frame.
    this.paintPreview();
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

  /** Advances to the next frame, then paints it - the animation timer's tick (see
   *  restartPreviewTimer). Painting the frame that's already showing is paintPreview()'s job, not this
   *  one's: they used to be a single method, which is why a single-frame sprite (no timer, so nothing
   *  ever called it) showed a preview that never updated no matter how much was drawn. */
  private tickPreview(): void {
    if (!this.previewCanvas || !this.previewCtx) return;
    this.previewFrame = (this.previewFrame + 1) % this.current.frames.length;
    this.paintPreview();
  }

  /**
   * Repaints the preview panel with whatever frame it's currently showing, at most once per animation
   * frame. Called on every content change (see refresh/redrawRegions), which during a fast stroke means
   * many times between two browser paints - hence the dirty flag instead of painting inline.
   *
   * On a large canvas the repaint itself is the expensive part (a full compositeToBitmap over every
   * layer - see PREVIEW_LIVE_CELL_LIMIT), so past that size it's held back until the stroke finishes
   * rather than competing with the drawing it's meant to be previewing; onPointerUp re-schedules, so
   * the deferred repaint still lands the moment the gesture ends.
   */
  private schedulePreviewRepaint(): void {
    if (!this.previewCanvas || !this.previewCtx) return;
    this.previewDirty = true;
    if (this.previewRepaintRafId !== null) return;
    this.previewRepaintRafId = requestAnimationFrame(() => {
      this.previewRepaintRafId = null;
      if (!this.previewDirty) return;
      if (this.painting && this.current.width * this.current.height > PREVIEW_LIVE_CELL_LIMIT) return;
      this.previewDirty = false;
      this.paintPreview();
    });
  }

  /** Starts or stops the animation timer so it always matches the current frame count. Checked on every
   *  refresh() rather than from each of addFrame/dupFrame/delFrame/moveFrame: those four all reach
   *  refresh(), and none of them used to restart the timer, so adding a 2nd frame to a single-frame
   *  sprite left the preview frozen on frame 1 forever - it animated only if some *other* action (a
   *  speed change, a reload) happened to restart the timer afterwards. Comparing against the timer's
   *  own existence makes this idempotent, so the common no-op refresh costs one comparison. */
  private syncPreviewTimer(): void {
    if (this.current.frames.length > 1 === (this.previewTimer !== null)) return;
    this.restartPreviewTimer();
  }

  /** Re-arms a preview repaint that schedulePreviewRepaint() skipped because a stroke was in progress
   *  - a no-op when nothing has actually changed, so ending a gesture that painted nothing (a stray
   *  click, a cancelled shape) doesn't cost a full recomposite on a large sprite. */
  private flushPreviewRepaint(): void {
    if (this.previewDirty) this.schedulePreviewRepaint();
  }

  private paintPreview(): void {
    if (!this.previewCanvas || !this.previewCtx) return;
    const frames = this.current.frames;
    // Clamped rather than assumed in range: frames can shrink under the preview (deleting a frame, or
    // loading a shorter sprite) between one paint and the next.
    if (this.previewFrame >= frames.length) this.previewFrame = 0;
    const { width, height } = this.current;
    const cellPx = PREVIEW_CELL_PX_BASE / Math.max(width, height);
    const ctx = this.previewCtx;
    ctx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
    ctx.imageSmoothingEnabled = false;
    const bmp = this.compositeToBitmap(frames[this.previewFrame], width, height);
    if (this.tiledPreview) {
      const tileCellPx = cellPx / 3;
      const tileW = width * tileCellPx;
      const tileH = height * tileCellPx;
      for (let ty = -1; ty <= 1; ty++) {
        for (let tx = -1; tx <= 1; tx++) {
          const dx = this.previewCanvas.width / 2 + tx * tileW - tileW / 2;
          const dy = this.previewCanvas.height / 2 + ty * tileH - tileH / 2;
          ctx.drawImage(bmp, 0, 0, width, height, dx, dy, tileW, tileH);
        }
      }
      return;
    }
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

  /** Selection/curve/move state that a history step invalidates - an undo can change the canvas out
   *  from under a selection, and a pending curve/move draft is meaningless against restored pixels.
   *  Shared by restoreSnapshot (full) and the 'cells' history path. */
  private resetTransientAfterHistory(): void {
    this.selection = null;
    this.lassoPoints = null;
    this.selectionMask = null;
    this.moveBuffer = null;
    if (this.curvePhase) this.clearCurveState();
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
    this.resetTransientAfterHistory();
    this.recomputeCanvasSize();
    this.restartPreviewTimer();
  }

  pushUndo(): void {
    if (this.curvePhase) this.clearCurveState();
    this.finalizeHistoryPending();
    this.historyPending = this.snapshot();
    this.redoStack = [];
    this.dirty = true;
  }

  /** Compacts the pending baseline (state before the just-finished edit) into a `HistoryEntry` and
   *  pushes it - a cheap `'cells'` rectangle diff where possible, a `'full'` snapshot pair otherwise
   *  (see buildHistoryEntry). A no-op edit (pushUndo bracketed nothing) pushes nothing. */
  private finalizeHistoryPending(): void {
    const before = this.historyPending;
    if (!before) return;
    this.historyPending = null;
    const entry = buildHistoryEntry(before, this.snapshot());
    if (entry === NO_CHANGE) return;
    this.undoStack.push(entry);
    trimHistory(this.undoStack);
  }

  /**
   * Applies one history entry in `dir` ('inverse' for undo, 'forward' for redo), repainting only what
   * changed. A `'full'` entry restores a whole snapshot (via applyHistoryEntry, which keeps the
   * onion-skin / canvas-size-change fallbacks and its own minimal-repaint diff). A `'cells'` entry -
   * the common case - writes just its stored rectangle back into the active frame's layers and
   * repaints that box: no snapshot restore, no full redraw, cost ~O(edited pixels).
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

  private applyHistoryDiff(entry: HistoryEntry, dir: 'inverse' | 'forward'): void {
    if (entry.kind === 'full') {
      // structuredClone, not the stored snapshot directly: restoreSnapshot aliases `s.frames` as the
      // live frame array, and unlike the old always-fresh-snapshot model this entry stays on the
      // stack for the opposite-direction step - a later edit would otherwise mutate it in place.
      this.applyHistoryEntry(structuredClone(dir === 'inverse' ? entry.before : entry.after));
      return;
    }
    // 'cells' entries are only created when frame index / layer structure / canvas size didn't change
    // across the edit, and the history chain is unbroken, so the active frame here already matches.
    // Set it anyway as a cheap guard, then write the stored slice and repaint just its box. The slice
    // is copied into the live cells array (applyRegion writes element by element), so the entry is not
    // aliased and stays reusable for the opposite-direction step.
    this.frameIndex = Math.min(entry.frameIndex, this.current.frames.length - 1);
    const layers = this.current.frames[this.frameIndex];
    this.activeLayerIndex = Math.min(entry.activeLayerIndex, layers.length - 1);
    applyRegion(layers, entry.box, this.current.width, dir === 'inverse' ? entry.before : entry.after);
    this.resetTransientAfterHistory();
    this.restartPreviewTimer();
    this.redrawRegions([entry.box]);
  }

  undo(): void {
    this.finalizeHistoryPending();
    const entry = this.undoStack.pop();
    if (!entry) return;
    this.applyHistoryDiff(entry, 'inverse');
    this.redoStack.push(entry);
    trimHistory(this.redoStack);
  }

  redo(): void {
    this.finalizeHistoryPending();
    const entry = this.redoStack.pop();
    if (!entry) return;
    this.applyHistoryDiff(entry, 'forward');
    this.undoStack.push(entry);
    trimHistory(this.undoStack);
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

  /** Exports the current sprite as a standalone .json file (not PNG) - lets an artist back up or share
   *  a sprite's actual editable data, not just a flattened image. GIF export was considered but
   *  intentionally skipped (would need a new dependency, out of scope for this pass). */
  exportSpriteJson(): void {
    const blob = new Blob([JSON.stringify(this.current, null, 2)], { type: 'application/json' });
    const name = (this.current.name || 'sprite').trim() || 'sprite';
    this.downloadBlob(blob, `${name}.json`);
  }

  /** Reads a .json file exported by exportSpriteJson (or hand-edited/older-format equivalent) and loads
   *  it as the current, unsaved sprite - always through storage.normalizeSprite so a differently-shaped
   *  or older-schema file gets the same width/height/layers backfill a sprite loaded from local storage
   *  would. Treated as brand new (id cleared) rather than silently overwriting whatever library entry
   *  the file's own id might collide with. */
  importSpriteFromFile(file: File, confirmDiscard: () => boolean, onError: (msg: string) => void): void {
    if (this.dirty && !confirmDiscard()) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const normalized = storage.normalizeSprite(parsed);
        if (!normalized || !Array.isArray(normalized.frames) || !normalized.frames.length || typeof normalized.width !== 'number' || typeof normalized.height !== 'number') {
          throw new Error('invalid sprite file');
        }
        normalized.id = null;
        this.current = normalized;
        this.frameIndex = 0;
        this.activeLayerIndex = 0;
        this.previewFrame = 0;
        this.selection = null;
        this.lassoPoints = null;
        this.selectionMask = null;
        this.moveBuffer = null;
        this.clearPan();
        this.zoomScale = this.defaultZoomForSize(Math.max(normalized.width, normalized.height));
        this.clearCurveState();
        this.undoStack = [];
        this.redoStack = [];
        this.historyPending = null;
        this.dirty = true;
        this.loadToken += 1;
        this.centerSymmetryAxis();
        this.recomputeCanvasSize();
        this.restartPreviewTimer();
        this.refresh();
      } catch (err) {
        console.error('importSpriteFromFile failed', err);
        onError(t('error.importFailed'));
      }
    };
    reader.onerror = () => onError(t('error.importFailed'));
    reader.readAsText(file);
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
    this.clearPan();
    this.zoomScale = this.defaultZoomForSize(Math.max(this.current.width, this.current.height));
    this.clearCurveState();
    this.undoStack = [];
    this.redoStack = [];
    this.historyPending = null;
    this.dirty = false;
    this.loadToken += 1;
    this.centerSymmetryAxis();
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
    this.clearPan();
    this.zoomScale = this.defaultZoomForSize(Math.max(this.current.width, this.current.height));
    this.clearCurveState();
    this.undoStack = [];
    this.redoStack = [];
    this.historyPending = null;
    this.dirty = false;
    this.loadToken += 1;
    this.centerSymmetryAxis();
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
      this.clearPan();
      this.clearCurveState();
      this.loadToken += 1;
      this.centerSymmetryAxis();
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
