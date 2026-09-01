import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  bresenhamLine,
  flipFrameH,
  flipFrameV,
  hexToRgb,
  inEllipseLocal,
  normalizeBox,
  paintLayers,
  rgbToHex,
  rotateFrame,
  shiftBox,
} from '@/lib/pixelMath';
import { t } from '@/lib/i18n';
import * as storage from '@/lib/storage';
import type { CanvasBackground, Cell, Frame, Layer, SelectionBox, Sprite, SymmetryMode, ToolName } from '@/lib/types';

export const DEFAULT_PALETTE_COLORS = [
  '#1a1a1a', '#ffffff', '#e74c3c', '#ff7043', '#f5c518', '#8bc34a', '#1e88e5', '#5e35b1',
];

const FRAME_LIMIT = 5;
const LAYER_LIMIT = storage.LAYER_LIMIT;
const BASE_CELL_PX = 16;
export const ZOOM_LEVELS = [0.5, 0.75, 1, 1.5, 2, 3];
const PREVIEW_CELL_PX_BASE = 64;
const UNDO_LIMIT = 50;
export const MAX_BRUSH_SIZE = 4;
const SPRAY_INTERVAL_MS = 55;
const TOOL_KEYS: Record<string, ToolName> = {
  b: 'pen', e: 'eraser', g: 'fill', i: 'eyedropper', l: 'line', u: 'curve', r: 'rect', c: 'ellipse',
  a: 'spray', k: 'gradient', s: 'select', m: 'move',
};
/** Tools where a right-click has an alternate meaning (erase, or reversed gradient) instead of opening the browser context menu. */
const ERASABLE_TOOLS = new Set<ToolName>(['pen', 'eraser', 'line', 'curve', 'rect', 'ellipse', 'fill', 'spray', 'gradient']);
/** Tools where holding Alt temporarily samples a color instead of the tool's normal action. */
const ALT_PICK_TOOLS = new Set<ToolName>(['pen', 'eraser', 'line', 'curve', 'rect', 'ellipse', 'fill', 'spray', 'gradient']);

type HandleName = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e';
const HANDLE_HIT_TOLERANCE = 7;
const HANDLE_SIZE = 6;
const HANDLE_CURSORS: Record<HandleName, string> = {
  nw: 'nwse-resize', se: 'nwse-resize',
  ne: 'nesw-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize',
  w: 'ew-resize', e: 'ew-resize',
};
const ROTATE_HANDLE_OFFSET = 24;
const ROTATE_HANDLE_RADIUS = 7;
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
  return JSON.parse(JSON.stringify(sprite));
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
  brushSize = 1;
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
  zoomIndex = 2;
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
  private windowListeners: Array<() => void> = [];

  init(notify: () => void): void {
    this.reactNotify = notify;
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

    this.restartPreviewTimer();

    const endGesture = () => this.onPointerUp();
    const forceEndGesture = () => {
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
    return BASE_CELL_PX * ZOOM_LEVELS[this.zoomIndex];
  }

  recomputeCanvasSize(): void {
    if (!this.canvas) return;
    const { width, height } = this.current;
    const cellPx = this.effectiveCellPx();
    this.canvas.width = width * cellPx;
    this.canvas.height = height * cellPx;
    this.canvas.style.backgroundSize = `${cellPx * 2}px ${cellPx * 2}px`;
  }

  zoomLabel(): string {
    return `${Math.round(ZOOM_LEVELS[this.zoomIndex] * 100)}%`;
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
    if (this.canvas && tool !== 'select') this.canvas.style.cursor = '';
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

  setBrushSize(size: number): void {
    this.brushSize = Math.min(MAX_BRUSH_SIZE, Math.max(1, Math.round(size)));
    this.reactNotify();
  }

  setGradientColor(color: string): void {
    this.gradientColor = color;
    this.reactNotify();
  }

  setTransformAllFrames(v: boolean): void {
    this.transformAllFrames = v;
    this.reactNotify();
  }

  zoomIn(): void {
    this.zoomIndex = Math.min(ZOOM_LEVELS.length - 1, this.zoomIndex + 1);
    this.recomputeCanvasSize();
    this.refresh();
  }

  zoomOut(): void {
    this.zoomIndex = Math.max(0, this.zoomIndex - 1);
    this.recomputeCanvasSize();
    this.refresh();
  }

  private defaultZoomIndexForSize(maxDim: number): number {
    if (maxDim >= 32) return ZOOM_LEVELS.indexOf(0.75);
    return 2;
  }

  setGridSize(newWidth: number, newHeight: number): void {
    if (newWidth === this.current.width && newHeight === this.current.height) return;
    this.pushUndo();
    const { width, height } = this.current;
    this.current.frames = this.current.frames.map((layers) =>
      layers.map((layer) => ({ ...layer, cells: storage.resampleFrame(layer.cells, width, height, newWidth, newHeight) }))
    );
    this.current.width = newWidth;
    this.current.height = newHeight;
    this.zoomIndex = this.defaultZoomIndexForSize(Math.max(newWidth, newHeight));
    this.frameIndex = Math.min(this.frameIndex, this.current.frames.length - 1);
    this.selection = null;
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
    const cloned: Layer = JSON.parse(JSON.stringify(layers[index]));
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
    this.refresh();
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
    const cloned: Layer[] = JSON.parse(JSON.stringify(this.current.frames[this.frameIndex]));
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
    if (key === 'v') {
      this.setSymmetry(this.symmetry === 'vertical' ? 'none' : 'vertical');
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
    this.moveBuffer = null;
    this.moveStartCell = null;
    this.moveDelta = { dx: 0, dy: 0 };
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
    this.shapePreviewCells = null;
    this.selectStart = null;
    this.selectionDraft = null;
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

  private hitTestHandle(e: { clientX: number; clientY: number }): HandleName | null {
    if (!this.selection) return null;
    const pt = this.pxFromEvent(e);
    if (!pt) return null;
    const cellPx = this.effectiveCellPx();
    const box = this.selection;
    const x0 = box.x0 * cellPx;
    const y0 = box.y0 * cellPx;
    const x1 = (box.x1 + 1) * cellPx;
    const y1 = (box.y1 + 1) * cellPx;
    const tol = HANDLE_HIT_TOLERANCE;
    const { px, py } = pt;
    const nearLeft = Math.abs(px - x0) <= tol;
    const nearRight = Math.abs(px - x1) <= tol;
    const nearTop = Math.abs(py - y0) <= tol;
    const nearBottom = Math.abs(py - y1) <= tol;
    const withinX = px >= x0 - tol && px <= x1 + tol;
    const withinY = py >= y0 - tol && py <= y1 + tol;
    if (nearLeft && nearTop) return 'nw';
    if (nearRight && nearTop) return 'ne';
    if (nearLeft && nearBottom) return 'sw';
    if (nearRight && nearBottom) return 'se';
    if (nearTop && withinX) return 'n';
    if (nearBottom && withinX) return 's';
    if (nearLeft && withinY) return 'w';
    if (nearRight && withinY) return 'e';
    return null;
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

  /**
   * Clamped to stay inside the canvas bitmap: a handle beyond those bounds would be both
   * invisible (canvas clips its own drawing) and unreachable (pointer events land on the
   * wrapper div instead, which deselects) - most noticeable with a selection flush against
   * an edge, e.g. selecting the whole sprite.
   */
  private rotateHandlePos(box: SelectionBox, cellPx: number): { hx: number; hy: number } {
    const { cx, cy } = this.selectionCenterPx(box, cellPx);
    const r = this.rotateHandleRadius(box, cellPx);
    const ang = -Math.PI / 2 + this.rotateAngle;
    const pad = ROTATE_HANDLE_RADIUS + 2;
    const maxW = this.canvas?.width ?? Infinity;
    const maxH = this.canvas?.height ?? Infinity;
    const hx = Math.min(Math.max(cx + r * Math.cos(ang), pad), Math.max(pad, maxW - pad));
    const hy = Math.min(Math.max(cy + r * Math.sin(ang), pad), Math.max(pad, maxH - pad));
    return { hx, hy };
  }

  private hitTestRotateHandle(e: { clientX: number; clientY: number }): boolean {
    if (!this.selection) return false;
    const pt = this.pxFromEvent(e);
    if (!pt) return false;
    const cellPx = this.effectiveCellPx();
    const { hx, hy } = this.rotateHandlePos(this.selection, cellPx);
    return Math.hypot(pt.px - hx, pt.py - hy) <= ROTATE_HIT_RADIUS;
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

  private cellFromEventClamped(e: { clientX: number; clientY: number }): Cell {
    const rect = this.canvas!.getBoundingClientRect();
    const cellPx = this.effectiveCellPx();
    const { width, height } = this.current;
    const x = Math.min(width - 1, Math.max(0, Math.floor((e.clientX - rect.left) / cellPx)));
    const y = Math.min(height - 1, Math.max(0, Math.floor((e.clientY - rect.top) / cellPx)));
    return { x, y };
  }

  private isInsideSelection(cell: Cell): boolean {
    if (!this.selection) return false;
    const box = this.selection;
    return cell.x >= box.x0 && cell.x <= box.x1 && cell.y >= box.y0 && cell.y <= box.y1;
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
        const c = frame[y * width + x];
        if (c) cells.push({ x, y, color: c });
        frame[y * width + x] = null;
      }
    }
    this.moveBuffer = { cells };
    this.moveStartCell = cell;
    this.moveDelta = { dx: 0, dy: 0 };
    this.refresh();
  }

  private captureSelectionPixels(box: SelectionBox): (string | null)[][] {
    const frame = this.activeCells();
    const width = this.current.width;
    const rows: (string | null)[][] = [];
    for (let y = box.y0; y <= box.y1; y++) {
      const row: (string | null)[] = [];
      for (let x = box.x0; x <= box.x1; x++) {
        row.push(frame[y * width + x]);
      }
      rows.push(row);
    }
    return rows;
  }

  copySelection(): void {
    if (this.tool !== 'select' || !this.selection) return;
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
    this.refresh();
  }

  private clearFrameRegion(box: SelectionBox): void {
    const frame = this.activeCells();
    const width = this.current.width;
    for (let y = box.y0; y <= box.y1; y++) {
      for (let x = box.x0; x <= box.x1; x++) frame[y * width + x] = null;
    }
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
    this.resizeHandle = null;
    this.resizeOrigin = null;
    this.resizeSource = null;
    this.resizePreview = null;
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
   * (nearest-neighbor) so the preview has no holes, unlike forward-mapping source pixels.
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
          if (srcX >= 0 && srcY >= 0 && srcX < w && srcY < h) {
            const color = source[srcY][srcX];
            if (color) cells.push({ x, y, color });
          }
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
    this.rotateOrigin = null;
    this.rotateSource = null;
    this.rotatePreview = null;
    this.rotateAngle = 0;
  }

  onPointerDown(e: React.PointerEvent<HTMLCanvasElement>): void {
    if (e.button === 2 && !ERASABLE_TOOLS.has(this.tool)) return;

    if (this.tool === 'select' && this.selection && this.hitTestRotateHandle(e)) {
      if (this.painting) this.resetGestureState();
      this.canvas?.setPointerCapture(e.pointerId);
      this.pushUndo();
      this.painting = true;
      this.rotateOrigin = { ...this.selection };
      this.rotateSource = this.captureSelectionPixels(this.selection);
      this.clearFrameRegion(this.selection);
      const pt = this.pxFromEvent(e)!;
      const cellPx = this.effectiveCellPx();
      const { cx, cy } = this.selectionCenterPx(this.rotateOrigin, cellPx);
      this.rotateStartAngle = Math.atan2(pt.py - cy, pt.px - cx);
      this.rotateAngle = 0;
      if (this.canvas) this.canvas.style.cursor = 'grabbing';
      const { cells, box } = this.computeRotatePreview(0);
      this.rotatePreview = cells;
      this.selection = box;
      this.refresh();
      return;
    }

    if (this.tool === 'select' && this.selection) {
      const handle = this.hitTestHandle(e);
      if (handle) {
        if (this.painting) this.resetGestureState();
        this.canvas?.setPointerCapture(e.pointerId);
        this.pushUndo();
        this.painting = true;
        this.resizeHandle = handle;
        this.resizeOrigin = { ...this.selection };
        this.resizeSource = this.captureSelectionPixels(this.selection);
        this.clearFrameRegion(this.selection);
        this.resizePreview = this.buildResizePreview(this.resizeSource, this.resizeOrigin, this.selection);
        this.refresh();
        return;
      }
    }

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
      this.refresh();
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
        this.shapePreviewCells = this.mirroredExpand(this.quadraticBezierCells(this.curveStart!, this.curveControl, this.curveEnd!));
        this.drawGrid(this.shapePreviewCells);
        this.reactNotify();
        return;
      }
      this.pushUndo();
      this.painting = true;
      this.curveStart = cell;
      this.curveEnd = cell;
      this.curveControl = null;
      this.curvePhase = 'drag-end';
      this.shapePreviewCells = this.mirroredExpand([cell]);
      this.drawGrid(this.shapePreviewCells);
      this.reactNotify();
      return;
    }

    this.pushUndo();
    this.painting = true;
    this.eraseOverride = e.button === 2;

    if (this.tool === 'line' || this.tool === 'rect' || this.tool === 'ellipse') {
      this.shapeStart = cell;
      const end = e.shiftKey ? this.constrainShapeEnd(cell, cell) : cell;
      this.shapePreviewCells = this.mirroredExpand(this.computeShapeCells(cell, end));
      this.drawGrid(this.shapePreviewCells);
      this.reactNotify();
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
      this.gradientPreview = this.gradientCellsPreview(cell, cell);
      this.drawGrid();
    } else {
      this.lastPaintCell = null;
      this.beginStroke();
      this.paintCell(cell.x, cell.y);
    }
  }

  onPointerMove(e: React.PointerEvent<HTMLCanvasElement>): void {
    if (!this.painting) {
      if (this.tool === 'select' && this.selection && this.canvas) {
        if (this.hitTestRotateHandle(e)) {
          this.canvas.style.cursor = 'grab';
        } else {
          const handle = this.hitTestHandle(e);
          if (handle) {
            this.canvas.style.cursor = HANDLE_CURSORS[handle];
          } else {
            const hoverCell = this.cellFromEvent(e);
            this.canvas.style.cursor = hoverCell && this.isInsideSelection(hoverCell) ? 'move' : '';
          }
        }
      }
      return;
    }

    if (this.rotateOrigin && this.rotateSource) {
      const pt = this.pxFromEvent(e);
      if (!pt) return;
      const cellPx = this.effectiveCellPx();
      const { cx, cy } = this.selectionCenterPx(this.rotateOrigin, cellPx);
      const currentAngle = Math.atan2(pt.py - cy, pt.px - cx);
      this.rotateAngle = currentAngle - this.rotateStartAngle;
      const { cells, box } = this.computeRotatePreview(this.rotateAngle);
      this.rotatePreview = cells;
      this.selection = box;
      this.drawGrid();
      return;
    }

    if (this.resizeHandle && this.resizeOrigin && this.resizeSource) {
      const c = this.cellFromEventClamped(e);
      const box = this.computeResizedBox(this.resizeOrigin, this.resizeHandle, c);
      this.selection = box;
      this.resizePreview = this.buildResizePreview(this.resizeSource, this.resizeOrigin, box);
      this.drawGrid();
      return;
    }

    const cell = this.cellFromEvent(e);

    if (this.moveBuffer) {
      if (!cell || !this.moveStartCell) return;
      this.moveDelta = { dx: cell.x - this.moveStartCell.x, dy: cell.y - this.moveStartCell.y };
      this.drawGrid();
      return;
    }

    if (this.tool === 'select') {
      if (!cell || !this.selectStart) return;
      this.selectionDraft = normalizeBox(this.selectStart, cell);
      this.drawGrid();
      return;
    }

    if (this.tool === 'curve') {
      if (!cell) return;
      if (this.curvePhase === 'drag-end') {
        this.curveEnd = cell;
        this.shapePreviewCells = this.mirroredExpand(bresenhamLine(this.curveStart!.x, this.curveStart!.y, cell.x, cell.y));
        this.drawGrid(this.shapePreviewCells);
      } else if (this.curveDraggingControl) {
        this.curveControl = cell;
        this.shapePreviewCells = this.mirroredExpand(this.quadraticBezierCells(this.curveStart!, this.curveControl, this.curveEnd!));
        this.drawGrid(this.shapePreviewCells);
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
      this.gradientPreview = this.gradientCellsPreview(this.gradientStart, this.gradientEnd);
      this.drawGrid();
      return;
    }

    if (!cell) return;
    if (this.shapeStart) {
      const end = e.shiftKey ? this.constrainShapeEnd(this.shapeStart, cell) : cell;
      this.shapePreviewCells = this.mirroredExpand(this.computeShapeCells(this.shapeStart, end));
      this.drawGrid(this.shapePreviewCells);
    } else if (this.tool === 'pen' || this.tool === 'eraser') {
      this.paintCell(cell.x, cell.y, true);
    }
  }

  onPointerUp(): void {
    if (!this.painting) return;
    this.painting = false;
    this.stopSprayTimer();

    if (this.rotateOrigin) {
      this.commitRotate();
      this.refresh();
      return;
    }

    if (this.resizeHandle) {
      this.commitResize();
      this.refresh();
      return;
    }

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
          this.shapePreviewCells = this.mirroredExpand(this.quadraticBezierCells(this.curveStart, this.curveControl, this.curveEnd));
          this.drawGrid(this.shapePreviewCells);
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
      this.selectStart = null;
      this.selectionDraft = null;
      this.refresh();
      return;
    }

    if (this.tool === 'gradient') {
      if (this.gradientPreview) {
        const frame = this.activeCells();
        const { width, height } = this.current;
        this.gradientPreview.forEach((c) => {
          if (c.x >= 0 && c.y >= 0 && c.x < width && c.y < height) frame[c.y * width + c.x] = c.color;
        });
        this.addSavedColor(this.color);
        this.addSavedColor(this.gradientColor);
      }
      this.gradientStart = null;
      this.gradientEnd = null;
      this.gradientPreview = null;
      this.eraseOverride = false;
      this.refresh();
      return;
    }

    if (this.shapeStart && this.shapePreviewCells) {
      const frame = this.activeCells();
      const { width, height } = this.current;
      const shapeColor = this.eraseOverride ? null : this.color;
      this.shapePreviewCells.forEach((c) => {
        if (c.x >= 0 && c.y >= 0 && c.x < width && c.y < height) frame[c.y * width + c.x] = shapeColor;
      });
      if (shapeColor) this.addSavedColor(shapeColor);
      this.shapeStart = null;
      this.shapePreviewCells = null;
    }
    this.lastPaintCell = null;
    this.strokeSnapshot = null;
    this.strokePoints = [];
    this.eraseOverride = false;
    this.refresh();
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

  private computeShapeCells(start: Cell, end: Cell): Cell[] {
    if (this.tool === 'line') {
      return bresenhamLine(start.x, start.y, end.x, end.y);
    }
    if (this.tool === 'rect') {
      const x0 = Math.min(start.x, end.x);
      const x1 = Math.max(start.x, end.x);
      const y0 = Math.min(start.y, end.y);
      const y1 = Math.max(start.y, end.y);
      const cells: Cell[] = [];
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (this.shapeFilled || x === x0 || x === x1 || y === y0 || y === y1) cells.push({ x, y });
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
        if (!inEllipseLocal(x + 0.5, y + 0.5, cx, cy, Math.max(0.5, rx - 1), Math.max(0.5, ry - 1))) cells.push({ x, y });
      }
    }
    return cells;
  }

  /** Samples a quadratic bezier through p0/p1/p2 and connects the samples with bresenham lines so the curve has no gaps. */
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
    return cells.filter((c) => {
      const key = `${c.x},${c.y}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
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

  private paintCell(x: number, y: number, isMove?: boolean): void {
    const { width, height } = this.current;
    const inBounds = (px: number, py: number) => px >= 0 && py >= 0 && px < width && py < height;

    if (isMove && this.lastPaintCell) {
      bresenhamLine(this.lastPaintCell.x, this.lastPaintCell.y, x, y).forEach((p) => {
        if (inBounds(p.x, p.y)) this.strokeStep(p.x, p.y);
      });
    } else if (inBounds(x, y)) {
      this.strokeStep(x, y);
    }
    this.refresh();
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
    const stack: [number, number][] = [[x, y]];
    while (stack.length) {
      const [cx, cy] = stack.pop()!;
      if (cx < 0 || cy < 0 || cx >= width || cy >= height) continue;
      const idx = cy * width + cx;
      if (frame[idx] !== target) continue;
      frame[idx] = fillColor;
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
  }

  // --- rendering ---

  drawGrid(overlayCells?: Cell[]): void {
    if (!this.canvas || !this.ctx) return;
    const { width, height } = this.current;
    const cellPx = this.effectiveCellPx();
    const canvas = this.canvas;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (this.onionSkin && this.current.frames.length > 1) {
      const prevIdx = (this.frameIndex - 1 + this.current.frames.length) % this.current.frames.length;
      paintLayers(ctx, this.current.frames[prevIdx], width, height, cellPx, 0.3);
    }

    paintLayers(ctx, this.current.frames[this.frameIndex], width, height, cellPx);

    if (this.moveBuffer) {
      const { dx, dy } = this.moveDelta;
      this.moveBuffer.cells.forEach((c) => {
        const nx = c.x + dx;
        const ny = c.y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
        ctx.fillStyle = c.color;
        ctx.fillRect(nx * cellPx, ny * cellPx, cellPx, cellPx);
      });
    }

    if (this.resizePreview) {
      this.resizePreview.forEach((c) => {
        if (c.x < 0 || c.y < 0 || c.x >= width || c.y >= height) return;
        ctx.fillStyle = c.color;
        ctx.fillRect(c.x * cellPx, c.y * cellPx, cellPx, cellPx);
      });
    }

    if (this.rotatePreview) {
      this.rotatePreview.forEach((c) => {
        if (c.x < 0 || c.y < 0 || c.x >= width || c.y >= height) return;
        ctx.fillStyle = c.color;
        ctx.fillRect(c.x * cellPx, c.y * cellPx, cellPx, cellPx);
      });
    }

    if (this.gradientPreview) {
      this.gradientPreview.forEach((c) => {
        if (c.x < 0 || c.y < 0 || c.x >= width || c.y >= height) return;
        ctx.fillStyle = c.color;
        ctx.fillRect(c.x * cellPx, c.y * cellPx, cellPx, cellPx);
      });
    }

    if (overlayCells) {
      ctx.fillStyle = this.eraseOverride ? 'rgba(255,255,255,0.45)' : this.color;
      overlayCells.forEach((c) => {
        if (c.x < 0 || c.y < 0 || c.x >= width || c.y >= height) return;
        ctx.fillRect(c.x * cellPx, c.y * cellPx, cellPx, cellPx);
      });
    }

    if (this.tool === 'curve' && this.curvePhase === 'bend' && this.curveControl) {
      const hx = (this.curveControl.x + 0.5) * cellPx;
      const hy = (this.curveControl.y + 0.5) * cellPx;
      const s = HANDLE_SIZE;
      ctx.save();
      ctx.fillStyle = '#ffcc00';
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 1;
      ctx.fillRect(hx - s / 2, hy - s / 2, s, s);
      ctx.strokeRect(hx - s / 2, hy - s / 2, s, s);
      ctx.restore();
    }

    if (this.symmetry !== 'none') {
      ctx.save();
      ctx.strokeStyle = 'rgba(0,229,255,0.6)';
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      if (this.symmetry === 'vertical' || this.symmetry === 'both') {
        ctx.beginPath();
        ctx.moveTo((width * cellPx) / 2, 0);
        ctx.lineTo((width * cellPx) / 2, height * cellPx);
        ctx.stroke();
      }
      if (this.symmetry === 'horizontal' || this.symmetry === 'both') {
        ctx.beginPath();
        ctx.moveTo(0, (height * cellPx) / 2);
        ctx.lineTo(width * cellPx, (height * cellPx) / 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();
    }

    const activeBox = this.selectionDraft || this.selection;
    if (activeBox) {
      const shown = this.moveBuffer && this.selection && !this.selectionDraft ? shiftBox(activeBox, this.moveDelta) : activeBox;
      ctx.save();
      ctx.strokeStyle = '#ffcc00';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(shown.x0 * cellPx, shown.y0 * cellPx, (shown.x1 - shown.x0 + 1) * cellPx, (shown.y1 - shown.y0 + 1) * cellPx);
      ctx.setLineDash([]);
      ctx.restore();

      if (this.tool === 'select' && this.selection && !this.selectionDraft) {
        this.drawSelectionHandles(this.selection, cellPx);
      }
    }

    if (this.showGrid) {
      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= width; i++) {
        ctx.beginPath();
        ctx.moveTo(i * cellPx + 0.5, 0);
        ctx.lineTo(i * cellPx + 0.5, height * cellPx);
        ctx.stroke();
      }
      for (let i = 0; i <= height; i++) {
        ctx.beginPath();
        ctx.moveTo(0, i * cellPx + 0.5);
        ctx.lineTo(width * cellPx, i * cellPx + 0.5);
        ctx.stroke();
      }
    }
  }

  private drawSelectionHandles(box: SelectionBox, cellPx: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const x0 = box.x0 * cellPx;
    const y0 = box.y0 * cellPx;
    const x1 = (box.x1 + 1) * cellPx;
    const y1 = (box.y1 + 1) * cellPx;
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    const points: [number, number][] = [
      [x0, y0], [mx, y0], [x1, y0],
      [x0, my], [x1, my],
      [x0, y1], [mx, y1], [x1, y1],
    ];
    const s = HANDLE_SIZE;
    ctx.save();
    ctx.fillStyle = '#ffcc00';
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1;
    points.forEach(([px, py]) => {
      ctx.fillRect(px - s / 2, py - s / 2, s, s);
      ctx.strokeRect(px - s / 2, py - s / 2, s, s);
    });

    // Hidden entirely while actively dragging - the connecting line and handle glyph are just
    // clutter once the user has already grabbed the handle and is watching the artwork rotate;
    // they reappear at rest once the drag ends.
    if (!this.rotateOrigin) {
      const { hx, hy } = this.rotateHandlePos(box, cellPx);
      ctx.strokeStyle = '#ffcc00';
      ctx.beginPath();
      ctx.moveTo(mx, y0);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      this.drawRotateIcon(ctx, hx, hy);
    }

    ctx.restore();
  }

  /** A circular-arrow "rotate" glyph (⟳-style), matching the affordance PowerPoint uses for its rotate handle. */
  private drawRotateIcon(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    const r = ROTATE_HANDLE_RADIUS;
    const start = Math.PI * 0.2;
    const end = Math.PI * 1.85;
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffcc00';
    ctx.beginPath();
    ctx.arc(x, y, r, start, end);
    ctx.stroke();

    const tipAngle = end;
    const tipX = x + r * Math.cos(tipAngle);
    const tipY = y + r * Math.sin(tipAngle);
    const tangent = tipAngle + Math.PI / 2;
    const headLen = r * 0.85;
    const spread = Math.PI * 0.7;
    ctx.fillStyle = '#ffcc00';
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX + headLen * Math.cos(tangent + spread), tipY + headLen * Math.sin(tangent + spread));
    ctx.lineTo(tipX + headLen * Math.cos(tangent - spread), tipY + headLen * Math.sin(tangent - spread));
    ctx.closePath();
    ctx.fill();
  }

  /** Re-armed whenever the current sprite's frameMs changes, or a different sprite becomes current. */
  private restartPreviewTimer(): void {
    if (this.previewTimer) clearInterval(this.previewTimer);
    this.previewTimer = setInterval(() => this.tickPreview(), this.current.frameMs);
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
    ctx.save();
    ctx.translate((this.previewCanvas.width - width * cellPx) / 2, (this.previewCanvas.height - height * cellPx) / 2);
    paintLayers(ctx, frames[this.previewFrame], width, height, cellPx);
    ctx.restore();
  }

  // --- undo/redo ---

  private snapshot(): Snapshot {
    return {
      frames: JSON.parse(JSON.stringify(this.current.frames)),
      width: this.current.width,
      height: this.current.height,
      frameIndex: this.frameIndex,
      activeLayerIndex: this.activeLayerIndex,
      frameMs: this.current.frameMs,
    };
  }

  private restoreSnapshot(s: Snapshot): void {
    this.current.frames = s.frames;
    this.current.width = s.width;
    this.current.height = s.height;
    this.current.frameMs = s.frameMs;
    this.frameIndex = Math.min(s.frameIndex, s.frames.length - 1);
    this.activeLayerIndex = Math.min(s.activeLayerIndex, this.current.frames[this.frameIndex].length - 1);
    this.selection = null;
    this.moveBuffer = null;
    if (this.curvePhase) this.clearCurveState();
    this.recomputeCanvasSize();
    this.restartPreviewTimer();
    this.refresh();
  }

  pushUndo(): void {
    if (this.curvePhase) this.clearCurveState();
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.dirty = true;
  }

  undo(): void {
    if (!this.undoStack.length) return;
    this.redoStack.push(this.snapshot());
    this.restoreSnapshot(this.undoStack.pop()!);
  }

  redo(): void {
    if (!this.redoStack.length) return;
    this.undoStack.push(this.snapshot());
    this.restoreSnapshot(this.redoStack.pop()!);
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
    this.moveBuffer = null;
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
    const finalName = name.trim() || (type === 'fish' ? t('sprite.defaultFishName') : t('sprite.defaultObjectName'));
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
    this.moveBuffer = null;
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
      this.moveBuffer = null;
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
