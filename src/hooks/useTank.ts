import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { t } from '@/lib/i18n';
import { pixelateImageFile } from '@/lib/imageImport';
import { paintLayers } from '@/lib/pixelMath';
import * as storage from '@/lib/storage';
import type { BackgroundTransform, Instance, RoomInstance, SelectionBox, Sprite, SwimSpeed, TankGroup, TankShape } from '@/lib/types';

const DISPLAY_SCALE = 4;
const TAP_MOVE_THRESHOLD = 6;
/** Matches index.css's --tank-outline - the bold pixel-art border TankEngine.draw() strokes around
 *  the tank's own shape, independent of the active UI theme (same rationale as the CSS var: real
 *  aquarium glass doesn't recolor to match a cotton-candy desk skin). */
const TANK_OUTLINE_COLOR = '#1c2436';
const TANK_OUTLINE_WIDTH = 5;
/** Slider ranges for the two shape-specific knobs below - see TankEngine.tankCornerRadiusFrac and
 *  tankOvalTopCutFrac. Capped well short of 0.5 so the shape can't invert/degenerate into nothing. */
export const ROUNDED_RADIUS_MIN = 0.05;
export const ROUNDED_RADIUS_MAX = 0.5;
export const OVAL_TOP_CUT_MIN = 0;
export const OVAL_TOP_CUT_MAX = 0.45;
/** Room decorations (kind 'room' sprites, placed in the area around the tank) are kept this many
 *  screen px inset from the viewport's edge on every side - satisfies "not flush against the
 *  canvas edge" regardless of viewport size. Capped as a fraction of the viewport (see
 *  clampRoomFrac) so a tiny viewport can't invert the clamp range. */
export const ROOM_MARGIN_PX = 16;

/** Background free-transform handles - see TankBackgroundOverlay.tsx, which renders these as a DOM
 *  layer in .tank-viewport (not this engine's own <canvas>) specifically so a placement dragged past
 *  the tank frame's edge stays visible/grabbable out to the viewport's edge instead of vanishing the
 *  instant it crosses the canvas's own raster bounds (a plain canvas can never draw outside itself).
 *  The gap is in tank canvas logical px (same space as Instance.x/y); the overlay scales it by
 *  effectiveScale to get on-screen px. */
export const BG_ROTATE_HANDLE_GAP = 24;
const BG_MIN_SCALE = 0.1;
const BG_MAX_SCALE = 8;
export type BgHandle = 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'rotate';

export const TANK_SIZE_MIN = { width: 300, height: 300 };
export const TANK_SIZE_MAX = { width: 1400, height: 900 };
/** Starting size when there's no saved preference - a reasonable "medium tank", not an attempt to
 *  match whatever the available space happens to be (trying to precisely capture that via a DOM
 *  measurement raced against the tab's own show/hide and nested-flex stretch timing in practice). */
export const TANK_SIZE_DEFAULT = { width: 900, height: 600 };
/** View zoom, as a fraction of "as large as fits the viewport" (see the auto-fit computation in
 *  TankCanvas) - 100% here never exceeds that fit size, so zooming in can't make the tank spill
 *  outside its viewport the way an unbounded zoom could. */
export const TANK_ZOOM_STEPS = [0.5, 0.75, 1];

/** Horizontal/vertical speed ranges (px/s) per swim-speed preset - randomized within the range on pick
 *  so same-speed fish still don't move in perfect lockstep. */
const SWIM_SPEED_PRESETS: Record<SwimSpeed, { vxMin: number; vxMax: number; vyMin: number; vyMax: number }> = {
  slow: { vxMin: 8, vxMax: 14, vyMin: 3, vyMax: 6 },
  medium: { vxMin: 18, vxMax: 28, vyMin: 6, vyMax: 12 },
  fast: { vxMin: 35, vxMax: 50, vyMin: 10, vyMax: 18 },
  veryFast: { vxMin: 55, vxMax: 80, vyMin: 15, vyMax: 25 },
};
export const SWIM_SPEEDS: SwimSpeed[] = ['slow', 'medium', 'fast', 'veryFast'];

function randomSwimVelocity(speed: SwimSpeed): { vx: number; vy: number } {
  const p = SWIM_SPEED_PRESETS[speed] ?? SWIM_SPEED_PRESETS.medium;
  return { vx: p.vxMin + Math.random() * (p.vxMax - p.vxMin), vy: p.vyMin + Math.random() * (p.vyMax - p.vyMin) };
}

type Snapshot = { instances: Instance[]; groups: TankGroup[]; roomInstances: RoomInstance[] };

class TankEngine {
  canvas: HTMLCanvasElement | null = null;
  ctx: CanvasRenderingContext2D | null = null;
  wrap: HTMLDivElement | null = null;
  /** The tank viewport element (see TankCanvas's .tank-viewport) - the placement area for room
   *  decorations, which live outside the tank's own canvas/coordinate space. */
  viewportEl: HTMLDivElement | null = null;

  sprites: Sprite[] = [];
  instances: Instance[] = [];
  groups: TankGroup[] = [];
  /** Decorations placed around the tank rather than inside it - see RoomInstance. Always rendered
   *  above the tank frame (so they can overlap it) by TankCanvas, which draws them as a DOM layer
   *  after (i.e. on top of) .tank-frame rather than through this engine's own <canvas>. */
  roomInstances: RoomInstance[] = [];

  /** Logical tank size (the actual simulation space fish swim in) set via the size controls or by
   *  dragging the resize handle - null only very briefly before init() runs. A view/layout
   *  preference, not tank content, so it's saved immediately rather than gated behind the manual
   *  Save button. This is independent of how large the tank is drawn on screen - see zoomIndex/
   *  displayScale for that. */
  tankWidth: number | null = null;
  tankHeight: number | null = null;

  /** The tank's swim-area silhouette - see TankShape. Like tankWidth/Height, takes effect
   *  immediately but only reaches localStorage via the manual Save button. */
  tankShape: TankShape = 'rectangle';

  /** 'rounded' only - corner radius as a fraction of min(tankWidth, tankHeight), user-adjustable via
   *  the shape group's slider (see ROUNDED_RADIUS_MIN/MAX). Read by both shapePath (the visual clip/
   *  outline) and clampCenterToShape (the physics containment), so the two always agree. */
  tankCornerRadiusFrac = 0.22;

  /** 'oval' only - how much of the ellipse's top is sliced off flat, as a fraction of tank height
   *  (0 = a full ellipse, larger values flatten more of the top - see OVAL_TOP_CUT_MIN/MAX for the
   *  slider's range). Same shapePath/clampCenterToShape split as tankCornerRadiusFrac above. */
  tankOvalTopCutFrac = 0.28;

  /** Which 'background'-type sprite (drawn in the pixel editor, same as fish/decor) is painted behind
   *  the fish - null means the default gradient. Like tankShape, takes effect immediately but only
   *  reaches localStorage via the manual Save button. */
  backgroundSpriteId: string | null = null;
  /** Free-transform (move/scale/rotate) placement of the background sprite - see BackgroundTransform.
   *  Reset to a centered, native-size default whenever a *different* background sprite is picked
   *  (setTankBackgroundSprite), then only ever changed by dragging its on-canvas handles. */
  backgroundTransform: BackgroundTransform = { x: 0, y: 0, scale: 1, rotation: 0 };
  /** Whether the background's move/resize/rotate handles are shown and interactive on the tank
   *  canvas right now - true only while the sidebar's Background tab is open (see
   *  setBackgroundEditing, called from TankBackgroundPanel), so it doesn't steal clicks meant for
   *  placing/selecting fish the rest of the time. */
  backgroundEditing = false;
  /** Whether the transform box/handles are actually drawn right now, separate from backgroundEditing
   *  (which just gates "is background interaction possible at all while this tab is open"). Saving
   *  the tank hides them - like Photoshop committing a free transform - so the finished placement
   *  isn't cluttered by a yellow box; clicking the background again (either its palette row or its
   *  own footprint on the canvas) brings them back for further adjustment. */
  backgroundHandlesVisible = true;
  /** Offscreen render of the background sprite at its current pixel dimensions and
   *  backgroundTransform.scale, reused across animation frames instead of re-running paintLayers'
   *  per-cell fillRect loop every frame - see drawBackground()/getBackgroundCache(). Reused in place
   *  (resized only when its own dimensions change) rather than replaced, so no new canvas is ever
   *  allocated just to redraw the same-size content. */
  private bgCacheCanvas: HTMLCanvasElement | null = null;
  private bgCacheCtx: CanvasRenderingContext2D | null = null;
  /** Identity of whatever's currently painted into bgCacheCanvas - a *reference* to the exact Sprite
   *  object last painted (not just its id) and the scale used, so the cache is invalidated whenever
   *  either actually changes: picking a different background (new id -> different object), scaling it
   *  via the resize handle (bgCacheScale mismatch), or the sprite's own pixel data being edited and
   *  re-saved (refreshPalette() reloads `sprites` from storage as freshly-parsed objects, so the old
   *  and new sprite objects are never `===` even when the id is unchanged). Position/rotation changes
   *  deliberately do NOT invalidate this - drawBackground() re-applies those every frame via
   *  ctx.translate/rotate around the cached bitmap, since they don't change what the bitmap looks like. */
  private bgCacheSpriteRef: Sprite | null = null;
  private bgCacheScale = 0;
  /** In-progress background handle drag, captured on pointerdown - see startBgDrag/onBgPointerMove/Up.
   *  Which handle was grabbed comes from the DOM overlay itself (TankBackgroundOverlay - each corner/
   *  rotate/body element already knows what it is via native hit-testing), not a hand-rolled
   *  hit-test against canvas coordinates. */
  private bgDrag: {
    mode: 'move' | 'resize' | 'rotate';
    startPointer: { x: number; y: number };
    startTransform: BackgroundTransform;
    /** 'resize' only: distance from center to the pointer at drag-start, to derive a scale ratio. */
    startDist: number;
  } | null = null;

  /** Index into TANK_ZOOM_STEPS - the user's view-zoom preference, expressed relative to "as large
   *  as fits the viewport" (see TankCanvas's auto-fit computation, which multiplies this in). */
  zoomIndex = TANK_ZOOM_STEPS.length - 1;

  /** The actual on-screen-pixels-per-logical-pixel ratio right now (auto-fit scale x zoom step),
   *  computed and kept in sync by TankCanvas since only it knows the live viewport size. Every
   *  screen<->logical conversion (canvasPoint, resizeCanvas) goes through this - never assume 1:1. */
  displayScale = 1;

  draggingInstance: Instance | null = null;
  dragOffset = { x: 0, y: 0 };
  dragStart = { x: 0, y: 0 };
  dragMoved = false;
  selectedId: string | null = null;

  /** Selected room decoration (mutually exclusive with selectedId/marqueeIds - see selectInstance
   *  and selectRoomInstance). */
  selectedRoomId: string | null = null;
  private draggingRoomId: string | null = null;
  private roomDragOffsetFrac = { x: 0, y: 0 };
  private roomDragMoved = false;
  private roomDragUndoSnapshot: Snapshot | null = null;

  /** Whether the Fish Tank tab is the active one - set from TankPanel via setActive(), same pattern
   *  as the sprite editor's engine.active. Gates the Ctrl+Z/Ctrl+Y listener below so it doesn't
   *  steal undo/redo from the sprite editor while that tab is the one showing. */
  private active = false;

  /** Undo/redo for delete and move (drag) actions - a snapshot is the smallest state that fully
   *  captures both (instances carry position and group membership; groups carry name/zone). */
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private static readonly UNDO_LIMIT = 50;
  /** Captured at drag-start; only committed to `undoStack` on release if the drag actually moved
   *  something, so merely clicking to select a fish doesn't spam the undo history. */
  private dragUndoSnapshot: Snapshot | null = null;

  /** Rectangle-select over the tank (drag on empty space). `marqueeIds` persists after release so
   *  a floating action bar can offer Group/Delete; it's cleared on the next click/marquee. */
  marqueeIds: string[] | null = null;
  marqueeRect: SelectionBox | null = null;
  private marqueeStart: { x: number; y: number } | null = null;
  private marqueeActive = false;

  /** Armed by armZoneTool() on the currently-selected instance/group; the next drag on the canvas
   *  draws the zone rectangle for that target instead of selecting/marqueeing. */
  zoneDraftTarget: { kind: 'instance' | 'group'; id: string } | null = null;
  zoneDraftRect: SelectionBox | null = null;
  private zoneDrawStart: { x: number; y: number } | null = null;

  private paletteGhost: HTMLCanvasElement | null = null;
  private paletteGhostPx = { pw: 64, ph: 64 };
  private paletteDragSpriteId: string | null = null;
  private lastTime = 0;
  private rafId: number | null = null;
  /** True once resizeCanvas() has actually measured a real (visible, nonzero) size at least once.
   *  The animation loop starts on mount and runs every frame even while the Fish Tank tab is hidden
   *  (both tabs stay mounted - see TankPanel), so without this guard update() would clamp every
   *  fish's position against the <canvas> element's un-set HTML default (300x150) for however long
   *  the tab stays hidden, silently collapsing everyone toward that tiny corner before the tab is
   *  ever shown. */
  private hasSized = false;
  /** True when the in-memory tank has edits not yet written to localStorage (manual save() - see
   *  persist()/save()/refresh()). Gates the beforeunload warning and the Save/Refresh buttons. */
  dirty = false;
  private reactNotify: () => void = () => {};

  init(notify: () => void): void {
    this.reactNotify = notify;
    this.sprites = storage.loadSprites() || [];
    this.instances = (storage.loadInstances() || []).map((inst) => ({
      ...inst,
      groupId: inst.groupId ?? null,
      zone: inst.zone ?? null,
      visible: inst.visible ?? true,
    }));
    this.groups = storage.loadGroups().map((g) => ({ ...g, zone: g.zone ?? null }));
    this.roomInstances = (storage.loadRoomInstances() || []).map((r) => ({ ...r, visible: r.visible ?? true }));
    const savedSize = storage.loadTankSize();
    this.tankWidth = savedSize?.width ?? TANK_SIZE_DEFAULT.width;
    this.tankHeight = savedSize?.height ?? TANK_SIZE_DEFAULT.height;
    this.tankShape = storage.loadTankShape() ?? 'rectangle';
    this.tankCornerRadiusFrac = storage.loadTankShapeParam(storage.KEY_TANK_CORNER_RADIUS_FRAC) ?? 0.22;
    this.tankOvalTopCutFrac = storage.loadTankShapeParam(storage.KEY_TANK_OVAL_TOP_CUT_FRAC) ?? 0.28;
    this.backgroundSpriteId = storage.loadTankBackgroundSpriteId();
    this.backgroundTransform = storage.loadTankBackgroundTransform() ?? { x: 0, y: 0, scale: 1, rotation: 0 };

    this.rafId = requestAnimationFrame((t) => this.loop(t));
    document.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('beforeunload', this.onBeforeUnload);
  }

  destroy(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    document.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('beforeunload', this.onBeforeUnload);
  }

  private onBeforeUnload = (e: BeforeUnloadEvent): void => {
    if (!this.dirty) return;
    e.preventDefault();
    e.returnValue = '';
  };

  setActive(active: boolean): void {
    this.active = active;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) return;
    if (!this.active) return;

    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && key === 'z' && !e.shiftKey) {
      e.preventDefault();
      this.undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (key === 'y' || (key === 'z' && e.shiftKey))) {
      e.preventDefault();
      this.redo();
    }
  };

  private snapshotState(): Snapshot {
    return {
      instances: JSON.parse(JSON.stringify(this.instances)),
      groups: JSON.parse(JSON.stringify(this.groups)),
      roomInstances: JSON.parse(JSON.stringify(this.roomInstances)),
    };
  }

  private commitUndo(snapshot: Snapshot): void {
    this.undoStack.push(snapshot);
    if (this.undoStack.length > TankEngine.UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  private pushUndo(): void {
    this.commitUndo(this.snapshotState());
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): void {
    const snap = this.undoStack.pop();
    if (!snap) return;
    this.redoStack.push(this.snapshotState());
    this.instances = snap.instances;
    this.groups = snap.groups;
    this.roomInstances = snap.roomInstances;
    this.selectedId = null;
    this.marqueeIds = null;
    this.selectedRoomId = null;
    this.persist();
    this.persistGroups();
  }

  redo(): void {
    const snap = this.redoStack.pop();
    if (!snap) return;
    this.undoStack.push(this.snapshotState());
    this.instances = snap.instances;
    this.groups = snap.groups;
    this.roomInstances = snap.roomInstances;
    this.selectedId = null;
    this.marqueeIds = null;
    this.selectedRoomId = null;
    this.persist();
    this.persistGroups();
  }

  attachCanvas(el: HTMLCanvasElement | null): void {
    this.canvas = el;
    this.ctx = el ? el.getContext('2d') : null;
  }

  attachWrap(el: HTMLDivElement | null): void {
    this.wrap = el;
  }

  attachViewport(el: HTMLDivElement | null): void {
    this.viewportEl = el;
  }

  spriteDims(sprite?: Sprite): { width: number; height: number } {
    return {
      width: (sprite && sprite.width) || storage.DEFAULT_GRID_SIZE,
      height: (sprite && sprite.height) || storage.DEFAULT_GRID_SIZE,
    };
  }

  spritePx(sprite?: Sprite): { pw: number; ph: number } {
    const { width, height } = this.spriteDims(sprite);
    return { pw: width * DISPLAY_SCALE, ph: height * DISPLAY_SCALE };
  }

  spriteFor(inst: { spriteId: string }): Sprite | undefined {
    return this.sprites.find((s) => s.id === inst.spriteId);
  }

  private maxSwimY(ph: number): number {
    if (!this.canvas) return 0;
    const h = this.canvas.height;
    const sandH = Math.max(18, h * 0.08);
    return Math.max(0, h - sandH - ph);
  }

  private randomTargetY(ph: number): number {
    return Math.random() * this.maxSwimY(ph);
  }

  private zoneFor(inst: Instance): SelectionBox | null {
    if (inst.groupId) return this.groups.find((g) => g.id === inst.groupId)?.zone ?? null;
    return inst.zone;
  }

  /** Min/max allowed values for inst.x/inst.y (top-left anchored), folding in the zone (if any), the
   *  sand strip at the bottom, and the canvas edges - so a zone that's gone stale (canvas resized,
   *  zone now partly off-screen) never traps a fish outside the reachable area. */
  private swimBoundsFor(inst: Instance): { xMin: number; xMax: number; yMin: number; yMax: number } {
    const { pw, ph } = this.spritePx(this.spriteFor(inst));
    const w = this.canvas!.width;
    const h = this.canvas!.height;
    const sandH = Math.max(18, h * 0.08);
    const xMaxFull = Math.max(0, w - pw);
    const yMaxFull = Math.max(0, h - sandH - ph);
    const zone = this.zoneFor(inst);
    if (!zone) return { xMin: 0, xMax: xMaxFull, yMin: 0, yMax: yMaxFull };
    const xMin = Math.min(Math.max(0, zone.x0), xMaxFull);
    const xMax = Math.min(xMaxFull, Math.max(xMin, zone.x1 - pw));
    const yMin = Math.min(Math.max(0, zone.y0), yMaxFull);
    const yMax = Math.min(yMaxFull, Math.max(yMin, zone.y1 - ph));
    return { xMin, xMax, yMin, yMax };
  }

  private randomTargetYInBounds(yMin: number, yMax: number): number {
    return yMin + Math.random() * Math.max(0, yMax - yMin);
  }

  /** Corner radius used for the 'rounded' tank shape, in canvas px - scaled off the smaller
   *  dimension so it reads consistently whether the tank is wide or tall. Shared by the draw-time
   *  clip path and the placement/physics clamp below so the two always agree on where the corner
   *  cut actually is. */
  private shapeCornerRadius(w: number, h: number): number {
    return Math.min(w, h) * this.tankCornerRadiusFrac;
  }

  /** Pushes a sprite's center point (cx, cy), given its half-width/height (hx, hy), back inside the
   *  tank's chosen shape for a canvas of size w x h - the containment counterpart to the draw-time
   *  clip path (see shapePath). 'rectangle' behaves exactly like a plain edge clamp (so switching
   *  back to it is lossless); 'oval' and 'rounded' shrink that rectangle by the sprite's own
   *  half-extents and test/clamp against an inset ellipse or rounded-rect so the whole sprite - not
   *  just its center - stays inside the visible glass. Used for every placement/drag/swim site
   *  below, so an object dropped in a round tank's corner (or a fish swimming toward it) can't sit
   *  half outside the visible water. */
  private clampCenterToShape(cx: number, cy: number, hx: number, hy: number, w: number, h: number): { cx: number; cy: number; moved: boolean } {
    if (this.tankShape === 'rectangle' || w <= 0 || h <= 0) {
      const ncx = Math.min(Math.max(cx, hx), Math.max(hx, w - hx));
      const ncy = Math.min(Math.max(cy, hy), Math.max(hy, h - hy));
      return { cx: ncx, cy: ncy, moved: ncx !== cx || ncy !== cy };
    }
    if (this.tankShape === 'oval') {
      const ecx = w / 2;
      const ecy = h / 2;
      const rx = Math.max(1, w / 2 - hx);
      const ry = Math.max(1, h / 2 - hy);
      const dx = cx - ecx;
      const dy = cy - ecy;
      const norm = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
      let ncx = cx;
      let ncy = cy;
      let moved = false;
      if (norm > 1) {
        const scale = 1 / Math.sqrt(norm);
        ncx = ecx + dx * scale;
        ncy = ecy + dy * scale;
        moved = true;
      }
      // Flattened top (tankOvalTopCutFrac): the exact chord width at the cut line is narrower than
      // the full-ellipse rx used above, but re-deriving it here would only matter right at the two
      // corners where the flat top meets the curve - close enough for physics, exact for the visual
      // clip in shapePath.
      const topCut = Math.max(OVAL_TOP_CUT_MIN, Math.min(OVAL_TOP_CUT_MAX, this.tankOvalTopCutFrac));
      if (topCut > 0) {
        const topLimit = h * topCut + hy;
        if (ncy < topLimit) {
          ncy = topLimit;
          moved = true;
        }
      }
      return { cx: ncx, cy: ncy, moved };
    }
    // rounded
    let ncx = Math.min(Math.max(cx, hx), Math.max(hx, w - hx));
    let ncy = Math.min(Math.max(cy, hy), Math.max(hy, h - hy));
    const edgeMoved = ncx !== cx || ncy !== cy;
    const r = Math.max(0, Math.min(this.shapeCornerRadius(w, h), w / 2 - hx, h / 2 - hy));
    if (r > 0) {
      const cornerX = ncx < hx + r ? hx + r : ncx > w - hx - r ? w - hx - r : ncx;
      const cornerY = ncy < hy + r ? hy + r : ncy > h - hy - r ? h - hy - r : ncy;
      const ddx = ncx - cornerX;
      const ddy = ncy - cornerY;
      const dist = Math.hypot(ddx, ddy);
      if (dist > r) {
        const scale = r / dist;
        ncx = cornerX + ddx * scale;
        ncy = cornerY + ddy * scale;
        return { cx: ncx, cy: ncy, moved: true };
      }
    }
    return { cx: ncx, cy: ncy, moved: edgeMoved };
  }

  /** Top-left-anchored convenience wrapper around clampCenterToShape - every existing clamp site
   *  below worked in top-left x/y, so this keeps them as one-line swaps. */
  private clampTopLeftToShape(x: number, y: number, pw: number, ph: number, w: number, h: number): { x: number; y: number; moved: boolean } {
    const hx = pw / 2;
    const hy = ph / 2;
    const { cx, cy, moved } = this.clampCenterToShape(x + hx, y + hy, hx, hy, w, h);
    return { x: cx - hx, y: cy - hy, moved };
  }

  /** Screen (client) point -> canvas-relative *logical* point (i.e. dividing out displayScale, so
   *  it lands in the same coordinate space as instance x/y regardless of current zoom). Every
   *  pointer handler goes through this instead of repeating the rect subtraction so hit-testing/
   *  dragging/marquee/zone-drawing all agree on the same conversion. */
  private canvasPoint(clientX: number, clientY: number): { x: number; y: number } | null {
    if (!this.canvas) return null;
    const rect = this.canvas.getBoundingClientRect();
    return { x: (clientX - rect.left) / this.displayScale, y: (clientY - rect.top) / this.displayScale };
  }

  setDisplayScale(scale: number): void {
    this.displayScale = scale > 0 ? scale : 1;
  }

  zoomLabel(): string {
    return `${Math.round(TANK_ZOOM_STEPS[this.zoomIndex] * 100)}%`;
  }

  zoomIn(): void {
    this.zoomIndex = Math.min(TANK_ZOOM_STEPS.length - 1, this.zoomIndex + 1);
    this.reactNotify();
  }

  zoomOut(): void {
    this.zoomIndex = Math.max(0, this.zoomIndex - 1);
    this.reactNotify();
  }

  resizeCanvas(): void {
    if (!this.canvas || !this.wrap) return;
    const rect = this.wrap.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    // .tank-wrap's rendered size already reflects the current view zoom (the frame it's nested in
    // is drawn at tankWidth*displayScale) - dividing that back out here is what keeps the canvas's
    // own pixel buffer, and every instance's x/y, in one stable logical space independent of zoom.
    const newWidth = Math.max(200, Math.floor(rect.width / this.displayScale));
    const newHeight = Math.max(200, Math.floor(rect.height / this.displayScale));

    // Only reconcile existing instances against the new size once we've already sized at least once
    // for real - on that very first measurement there's nothing to reconcile (loaded positions are
    // trusted as-is), which is what keeps a reload from disturbing anyone before the tab is shown.
    //
    // Reconciling means *scaling* everyone's x/y by how much the tank actually changed, not clamping
    // them down to fit - a plain clamp only ever pulls positions in when the tank shrinks and can
    // never push them back out when it grows again, so shrink-then-grow used to permanently collapse
    // the whole layout toward the top-left instead of restoring it.
    if (this.hasSized && this.canvas.width > 0 && this.canvas.height > 0) {
      const scaleX = newWidth / this.canvas.width;
      const scaleY = newHeight / this.canvas.height;
      if (scaleX !== 1 || scaleY !== 1) {
        const scaleZone = (z: SelectionBox): SelectionBox => ({
          x0: z.x0 * scaleX,
          y0: z.y0 * scaleY,
          x1: z.x1 * scaleX,
          y1: z.y1 * scaleY,
        });
        this.groups.forEach((g) => {
          if (g.zone) g.zone = scaleZone(g.zone);
        });
        this.instances.forEach((inst) => {
          const { pw, ph } = this.spritePx(this.spriteFor(inst));
          const rawX = Math.min(Math.max(0, inst.x * scaleX), Math.max(0, newWidth - pw));
          const rawY = Math.min(Math.max(0, inst.y * scaleY), Math.max(0, newHeight - ph));
          const clamped = this.clampTopLeftToShape(rawX, rawY, pw, ph, newWidth, newHeight);
          inst.x = clamped.x;
          inst.y = clamped.y;
          inst.targetY *= scaleY;
          if (inst.zone) inst.zone = scaleZone(inst.zone);
        });
      }
    }

    this.canvas.width = newWidth;
    this.canvas.height = newHeight;
    this.hasSized = true;
  }

  /** Sets a custom tank size (from the W/H inputs, or synced back from a native resize-handle drag -
   *  see the ResizeObserver in TankCanvas). Clamped so the tank can't be dragged/typed down to
   *  nothing or past a reasonable ceiling. Takes effect immediately (the tank visibly resizes right
   *  away), but - like every other in-tank edit - doesn't touch localStorage until save(); doesn't
   *  touch instances directly either (resizeCanvas(), triggered by the resulting DOM size change,
   *  does the actual proportional repositioning). */
  setTankSize(width: number, height: number): void {
    const w = Math.round(Math.min(TANK_SIZE_MAX.width, Math.max(TANK_SIZE_MIN.width, width)));
    const h = Math.round(Math.min(TANK_SIZE_MAX.height, Math.max(TANK_SIZE_MIN.height, height)));
    if (this.tankWidth === w && this.tankHeight === h) return;
    this.tankWidth = w;
    this.tankHeight = h;
    this.dirty = true;
    this.reactNotify();
  }

  /** Back to the default medium size. */
  resetTankSize(): void {
    this.setTankSize(TANK_SIZE_DEFAULT.width, TANK_SIZE_DEFAULT.height);
  }

  /** Changes the tank's swim-area silhouette. Existing fish/decorations aren't force-moved right
   *  away (the shape clamp in update()/onCanvasPointerMove etc. gently pulls anyone now outside the
   *  new shape back in on the next frame they'd otherwise stray further out, same as a zone shrink). */
  setTankShape(shape: TankShape): void {
    if (this.tankShape === shape) return;
    this.tankShape = shape;
    this.dirty = true;
    this.reactNotify();
  }

  /** 'rounded' shape's corner radius, as a fraction of min(tankWidth, tankHeight) - see
   *  ROUNDED_RADIUS_MIN/MAX for the slider's range. */
  setTankCornerRadius(frac: number): void {
    const clamped = Math.min(ROUNDED_RADIUS_MAX, Math.max(ROUNDED_RADIUS_MIN, frac));
    if (this.tankCornerRadiusFrac === clamped) return;
    this.tankCornerRadiusFrac = clamped;
    this.dirty = true;
    this.reactNotify();
  }

  /** 'oval' shape's top-cut amount, as a fraction of tank height - see OVAL_TOP_CUT_MIN/MAX. */
  setTankOvalTopCut(frac: number): void {
    const clamped = Math.min(OVAL_TOP_CUT_MAX, Math.max(OVAL_TOP_CUT_MIN, frac));
    if (this.tankOvalTopCutFrac === clamped) return;
    this.tankOvalTopCutFrac = clamped;
    this.dirty = true;
    this.reactNotify();
  }

  refreshPalette(): void {
    this.sprites = storage.loadSprites() || [];
    this.reactNotify();
  }

  /** Alternative to hand-drawing a background in the pixel editor: downsamples an uploaded photo
   *  into a new 'background'-type sprite (see pixelateImageFile) so it reads as pixel art rather
   *  than a pasted-in photo, saves it to the shared sprite library immediately (like the editor's own
   *  "Save to library"), and selects it as the tank's active background. Errors (a corrupt/
   *  unreadable file) are surfaced to the caller rather than swallowed, since this runs from a file
   *  picker with no other feedback path. */
  async addBackgroundFromImage(file: File): Promise<void> {
    const { width, height, frame } = await pixelateImageFile(file, storage.MAX_BACKGROUND_GRID_SIZE.width, storage.MAX_BACKGROUND_GRID_SIZE.height);
    const sprite: Sprite = {
      id: storage.uid('sprite'),
      name: file.name.replace(/\.[^./\\]+$/, '') || t('sprite.defaultBackgroundName'),
      type: 'background',
      width,
      height,
      frames: [[storage.makeLayer(frame)]],
      frameMs: storage.DEFAULT_FRAME_MS,
    };
    const all = [...(storage.loadSprites() || []), sprite];
    storage.saveSprites(all);
    this.sprites = all;
    this.setTankBackgroundSprite(sprite.id);
  }

  /** Selects a 'background'-type sprite by id to paint behind the fish, or null for the default
   *  gradient. Takes effect immediately but (like tankShape) only reaches localStorage via the
   *  manual Save button. Switching to a *different* sprite re-centers its transform at native size -
   *  re-selecting the one already active leaves whatever placement the user set alone. */
  setTankBackgroundSprite(id: string | null): void {
    // Re-picking the sprite (even the one already active) is also how the user brings the handles
    // back after a save hid them - see backgroundHandlesVisible.
    this.backgroundHandlesVisible = true;
    if (this.backgroundSpriteId === id) {
      this.reactNotify();
      return;
    }
    this.backgroundSpriteId = id;
    if (id) {
      const w = this.canvas?.width ?? TANK_SIZE_DEFAULT.width;
      const h = this.canvas?.height ?? TANK_SIZE_DEFAULT.height;
      this.backgroundTransform = { x: w / 2, y: h / 2, scale: 1, rotation: 0 };
    }
    this.dirty = true;
    this.reactNotify();
  }

  /** Shows/activates the background's move/resize/rotate handles on the tank canvas - see
   *  backgroundEditing. Called from TankBackgroundPanel while its tab is the visible one. */
  setBackgroundEditing(editing: boolean): void {
    if (this.backgroundEditing === editing) return;
    this.backgroundEditing = editing;
    this.reactNotify();
  }

  /** Brings the handles back after a save hid them (see backgroundHandlesVisible) - called when the
   *  user clicks the background's own footprint in TankBackgroundOverlay while it's hidden. */
  revealBackgroundHandles(): void {
    if (this.backgroundHandlesVisible) return;
    this.backgroundHandlesVisible = true;
    this.reactNotify();
  }

  /** Half-width/height (canvas px) of the selected background sprite's current on-canvas footprint,
   *  or null if there isn't one - read by TankBackgroundOverlay to size/position the DOM box. */
  backgroundBoxHalfSize(): { halfW: number; halfH: number } | null {
    const sprite = this.backgroundSpriteId
      ? this.sprites.find((s) => s.id === this.backgroundSpriteId && s.type === 'background')
      : null;
    if (!sprite) return null;
    const { width: sw, height: sh } = this.spriteDims(sprite);
    const cellPx = DISPLAY_SCALE * this.backgroundTransform.scale;
    return { halfW: (sw * cellPx) / 2, halfH: (sh * cellPx) / 2 };
  }

  /** Starts a move/resize/rotate drag - called from TankBackgroundOverlay's pointerdown on the box
   *  body or one of its handle elements, which already knows which one from native DOM hit-testing
   *  (no hand-rolled geometry hit-test needed, unlike when this lived on the canvas). */
  startBgDrag(handle: BgHandle, clientX: number, clientY: number): void {
    const p = this.canvasPoint(clientX, clientY);
    if (!p) return;
    const startDist = Math.hypot(p.x - this.backgroundTransform.x, p.y - this.backgroundTransform.y) || 1;
    this.bgDrag = {
      mode: handle === 'rotate' ? 'rotate' : handle === 'move' ? 'move' : 'resize',
      startPointer: p,
      startTransform: { ...this.backgroundTransform },
      startDist,
    };
    this.reactNotify();
  }

  onBgPointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    if (!this.bgDrag) return;
    const p = this.canvasPoint(e.clientX, e.clientY);
    if (!p) return;
    const { mode, startPointer, startTransform, startDist } = this.bgDrag;
    if (mode === 'move') {
      this.backgroundTransform = {
        ...startTransform,
        x: startTransform.x + (p.x - startPointer.x),
        y: startTransform.y + (p.y - startPointer.y),
      };
    } else if (mode === 'resize') {
      const dist = Math.hypot(p.x - startTransform.x, p.y - startTransform.y);
      const scale = Math.max(BG_MIN_SCALE, Math.min(BG_MAX_SCALE, startTransform.scale * (dist / startDist)));
      this.backgroundTransform = { ...startTransform, scale };
    } else {
      const startAngle = Math.atan2(startPointer.y - startTransform.y, startPointer.x - startTransform.x);
      const currentAngle = Math.atan2(p.y - startTransform.y, p.x - startTransform.x);
      this.backgroundTransform = { ...startTransform, rotation: startTransform.rotation + (currentAngle - startAngle) };
    }
    this.reactNotify();
  }

  onBgPointerUp(): void {
    if (!this.bgDrag) return;
    this.bgDrag = null;
    this.dirty = true;
    this.reactNotify();
  }

  removeInstancesBySprite(spriteId: string): void {
    this.instances = this.instances.filter((inst) => inst.spriteId !== spriteId);
    this.roomInstances = this.roomInstances.filter((r) => r.spriteId !== spriteId);
    if (this.backgroundSpriteId === spriteId) {
      this.backgroundSpriteId = null;
      this.dirty = true;
    }
    this.pruneEmptyGroups();
    this.persist();
  }

  /** The tank is manual-save (see save()/refresh() below) - every in-tank edit funnels through this
   *  (or persistGroups()) to mark the in-memory state dirty and re-render, but nothing touches
   *  localStorage until the user explicitly saves. */
  private persist(): void {
    this.dirty = true;
    this.reactNotify();
  }

  private persistGroups(): void {
    this.dirty = true;
    this.reactNotify();
  }

  /** Writes the current in-memory instances/groups/tank size to localStorage. */
  save(): void {
    try {
      storage.saveInstances(this.instances);
      storage.saveGroups(this.groups);
      storage.saveRoomInstances(this.roomInstances);
      storage.saveTankSize({ width: this.tankWidth ?? TANK_SIZE_DEFAULT.width, height: this.tankHeight ?? TANK_SIZE_DEFAULT.height });
      storage.saveTankShape(this.tankShape);
      storage.saveTankShapeParam(storage.KEY_TANK_CORNER_RADIUS_FRAC, this.tankCornerRadiusFrac);
      storage.saveTankShapeParam(storage.KEY_TANK_OVAL_TOP_CUT_FRAC, this.tankOvalTopCutFrac);
      storage.saveTankBackgroundSpriteId(this.backgroundSpriteId);
      storage.saveTankBackgroundTransform(this.backgroundTransform);
      this.dirty = false;
    } catch (err) {
      console.warn('tank save failed', err);
    }
    // Committing the placement, Photoshop-free-transform-style - see backgroundHandlesVisible.
    this.backgroundHandlesVisible = false;
    this.reactNotify();
  }

  /** Reloads instances/groups/tank size from localStorage, discarding any unsaved in-memory edits
   *  (including an unsaved resize) - prompts first if there's actually something to lose (mirrors
   *  the sprite editor's newSprite()). */
  refresh(confirmDiscard: () => boolean): void {
    if (this.dirty && !confirmDiscard()) return;
    this.instances = (storage.loadInstances() || []).map((inst) => ({
      ...inst,
      groupId: inst.groupId ?? null,
      zone: inst.zone ?? null,
      visible: inst.visible ?? true,
    }));
    this.groups = storage.loadGroups().map((g) => ({ ...g, zone: g.zone ?? null }));
    this.roomInstances = (storage.loadRoomInstances() || []).map((r) => ({ ...r, visible: r.visible ?? true }));
    const savedSize = storage.loadTankSize();
    this.tankWidth = savedSize?.width ?? TANK_SIZE_DEFAULT.width;
    this.tankHeight = savedSize?.height ?? TANK_SIZE_DEFAULT.height;
    this.tankShape = storage.loadTankShape() ?? 'rectangle';
    this.tankCornerRadiusFrac = storage.loadTankShapeParam(storage.KEY_TANK_CORNER_RADIUS_FRAC) ?? 0.22;
    this.tankOvalTopCutFrac = storage.loadTankShapeParam(storage.KEY_TANK_OVAL_TOP_CUT_FRAC) ?? 0.28;
    this.backgroundSpriteId = storage.loadTankBackgroundSpriteId();
    this.backgroundTransform = storage.loadTankBackgroundTransform() ?? { x: 0, y: 0, scale: 1, rotation: 0 };
    this.selectedId = null;
    this.marqueeIds = null;
    this.draggingInstance = null;
    this.selectedRoomId = null;
    this.draggingRoomId = null;
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
    this.reactNotify();
  }

  clearTank(confirmClear: () => boolean): void {
    if (!this.instances.length) return;
    if (!confirmClear()) return;
    this.pushUndo();
    this.instances = [];
    this.groups = [];
    this.marqueeIds = null;
    this.selectInstance(null);
    this.persist();
    this.persistGroups();
  }

  addInstance(spriteId: string, x: number, y: number): void {
    const sprite = this.sprites.find((s) => s.id === spriteId);
    if (!sprite || !this.canvas) return;
    const { pw, ph } = this.spritePx(sprite);
    const swimSpeed: SwimSpeed = 'medium';
    const { vx, vy } = sprite.type === 'fish' ? randomSwimVelocity(swimSpeed) : { vx: 0, vy: 0 };
    const placed = this.clampTopLeftToShape(x - pw / 2, y - ph / 2, pw, ph, this.canvas.width, this.canvas.height);
    const inst: Instance = {
      id: storage.uid('inst'),
      spriteId,
      kind: sprite.type,
      x: placed.x,
      y: placed.y,
      dir: Math.random() < 0.5 ? -1 : 1,
      vx,
      vy,
      targetY: sprite.type === 'fish' ? this.randomTargetY(ph) : 0,
      frameIndex: 0,
      frameTimer: 0,
      bobPhase: Math.random() * Math.PI * 2,
      isDragging: false,
      swimSpeed,
      groupId: null,
      schoolOffsetY: (Math.random() - 0.5) * 40,
      zone: null,
      visible: true,
    };
    this.instances.push(inst);
    this.persist();
  }

  /** Keeps a room decoration's center at least ROOM_MARGIN_PX in from every edge of `rect` (the
   *  viewport), expressed as a clamp on its fraction - so it can never land flush against the
   *  outer edge regardless of viewport size. The margin fraction is capped at 0.45 per axis so a
   *  very small viewport can't invert the min/max range. */
  private clampRoomFrac(xFrac: number, yFrac: number, rect: { width: number; height: number }): { xFrac: number; yFrac: number } {
    const mx = rect.width > 0 ? Math.min(0.45, ROOM_MARGIN_PX / rect.width) : 0;
    const my = rect.height > 0 ? Math.min(0.45, ROOM_MARGIN_PX / rect.height) : 0;
    return {
      xFrac: Math.min(1 - mx, Math.max(mx, xFrac)),
      yFrac: Math.min(1 - my, Math.max(my, yFrac)),
    };
  }

  /** Drops a new room decoration at the given screen point, converted into a viewport-relative,
   *  margin-clamped fraction (see clampRoomFrac) - counterpart to addInstance() for kind 'room'
   *  sprites, but placed in the viewport's coordinate space instead of the tank canvas's, since
   *  room decorations live around the tank rather than inside its swim space. */
  addRoomInstance(spriteId: string, clientX: number, clientY: number): void {
    const sprite = this.sprites.find((s) => s.id === spriteId);
    if (!sprite || !this.viewportEl) return;
    const rect = this.viewportEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const { xFrac, yFrac } = this.clampRoomFrac((clientX - rect.left) / rect.width, (clientY - rect.top) / rect.height, rect);
    const inst: RoomInstance = { id: storage.uid('room'), spriteId, xFrac, yFrac, visible: true };
    this.roomInstances.push(inst);
    this.persist();
  }

  selectRoomInstance(id: string | null): void {
    this.selectedRoomId = id;
    if (id) {
      this.selectedId = null;
      this.marqueeIds = null;
    }
    this.reactNotify();
  }

  removeRoomInstance(id: string): void {
    this.pushUndo();
    this.roomInstances = this.roomInstances.filter((r) => r.id !== id);
    if (this.selectedRoomId === id) this.selectedRoomId = null;
    this.persist();
  }

  onRoomPointerDown(e: React.PointerEvent<HTMLDivElement>, id: string): void {
    e.stopPropagation();
    const inst = this.roomInstances.find((r) => r.id === id);
    if (!inst || !this.viewportEl) return;
    const rect = this.viewportEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    this.roomDragOffsetFrac = {
      x: (e.clientX - rect.left) / rect.width - inst.xFrac,
      y: (e.clientY - rect.top) / rect.height - inst.yFrac,
    };
    this.draggingRoomId = id;
    this.roomDragMoved = false;
    this.roomDragUndoSnapshot = this.snapshotState();
    this.selectRoomInstance(id);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  onRoomPointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    if (!this.draggingRoomId || !this.viewportEl) return;
    const inst = this.roomInstances.find((r) => r.id === this.draggingRoomId);
    if (!inst) return;
    const rect = this.viewportEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const rawX = (e.clientX - rect.left) / rect.width - this.roomDragOffsetFrac.x;
    const rawY = (e.clientY - rect.top) / rect.height - this.roomDragOffsetFrac.y;
    const { xFrac, yFrac } = this.clampRoomFrac(rawX, rawY, rect);
    if (Math.abs(xFrac - inst.xFrac) > 0.0005 || Math.abs(yFrac - inst.yFrac) > 0.0005) this.roomDragMoved = true;
    inst.xFrac = xFrac;
    inst.yFrac = yFrac;
    this.reactNotify();
  }

  onRoomPointerUp(): void {
    if (!this.draggingRoomId) return;
    this.draggingRoomId = null;
    if (this.roomDragMoved && this.roomDragUndoSnapshot) this.commitUndo(this.roomDragUndoSnapshot);
    this.roomDragUndoSnapshot = null;
    if (this.roomDragMoved) this.persist();
    this.roomDragMoved = false;
  }

  /** Looked up by id (not stored directly) so the caller always gets the live instance from `instances`. */
  get selectedInstance(): Instance | null {
    return this.instances.find((inst) => inst.id === this.selectedId) ?? null;
  }

  /** The zone that actually governs the selected instance's movement right now - its group's zone
   *  if it's grouped, otherwise its own. Used by the UI to show current state and by draw(). */
  get selectedZone(): SelectionBox | null {
    const inst = this.selectedInstance;
    return inst ? this.zoneFor(inst) : null;
  }

  /** Arms zone-drawing for whatever's currently selected (the whole group, if the selection is
   *  grouped - same "acts on the group" convention as bringToFront/sendToBack). The next drag on
   *  the canvas becomes the zone rectangle instead of a select/marquee. */
  armZoneTool(): void {
    const inst = this.selectedInstance;
    if (!inst || inst.kind !== 'fish') return;
    this.zoneDraftTarget = inst.groupId ? { kind: 'group', id: inst.groupId } : { kind: 'instance', id: inst.id };
    this.zoneDraftRect = null;
    this.reactNotify();
  }

  cancelZoneTool(): void {
    this.zoneDraftTarget = null;
    this.zoneDraftRect = null;
    this.zoneDrawStart = null;
    this.reactNotify();
  }

  clearZone(): void {
    const inst = this.selectedInstance;
    if (!inst) return;
    if (inst.groupId) {
      const group = this.groups.find((g) => g.id === inst.groupId);
      if (!group) return;
      group.zone = null;
      this.persistGroups();
    } else {
      inst.zone = null;
      this.persist();
    }
  }

  private applyZone(target: { kind: 'instance' | 'group'; id: string }, zone: SelectionBox): void {
    const members = target.kind === 'group' ? this.instances.filter((i) => i.groupId === target.id) : [];
    if (target.kind === 'group') {
      const group = this.groups.find((g) => g.id === target.id);
      if (!group) return;
      group.zone = zone;
    } else {
      const inst = this.instances.find((i) => i.id === target.id);
      if (!inst) return;
      inst.zone = zone;
      members.push(inst);
    }
    // Snap anyone now outside the new zone back inside it immediately, instead of waiting for the
    // gradual swim-toward-target to eventually notice.
    members.forEach((i) => {
      const { xMin, xMax, yMin, yMax } = this.swimBoundsFor(i);
      i.x = Math.min(Math.max(i.x, xMin), xMax);
      i.y = Math.min(Math.max(i.y, yMin), yMax);
    });
    this.persist();
    this.persistGroups();
  }

  setInstanceSpeed(id: string, speed: SwimSpeed): void {
    const inst = this.instances.find((i) => i.id === id);
    if (!inst || inst.kind !== 'fish') return;
    inst.swimSpeed = speed;
    const { vx, vy } = randomSwimVelocity(speed);
    inst.vx = vx;
    inst.vy = vy;
    this.persist();
  }

  setInstanceVisible(id: string, visible: boolean): void {
    const inst = this.instances.find((i) => i.id === id);
    if (!inst) return;
    inst.visible = visible;
    this.persist();
  }

  /** Sets visibility on exactly the given instances - not necessarily a whole group. The Layers
   *  panel's per-type tabs (see TankLayers) show a mixed-type group's members split across tabs,
   *  so that group's eye toggle only affects whichever members are visible in the tab it's clicked
   *  from (e.g. toggling it from the Fish tab leaves that group's decorations untouched). */
  setInstancesVisible(ids: string[], visible: boolean): void {
    const idSet = new Set(ids);
    let changed = false;
    this.instances.forEach((i) => {
      if (idSet.has(i.id) && (i.visible ?? true) !== visible) {
        i.visible = visible;
        changed = true;
      }
    });
    if (changed) this.persist();
  }

  setRoomInstanceVisible(id: string, visible: boolean): void {
    const inst = this.roomInstances.find((r) => r.id === id);
    if (!inst) return;
    inst.visible = visible;
    this.persist();
  }

  private groupMemberIds(groupId: string): string[] {
    return this.instances.filter((i) => i.groupId === groupId).map((i) => i.id);
  }

  /** Other instance ids that should move together with `inst` while it's being dragged: its group's
   *  other members, or - if it's not grouped but is part of the current multi-item marquee
   *  selection - the rest of that selection. Drives both the drag-delta propagation in
   *  onCanvasPointerMove and the "draw whatever's moving on top" logic in draw(). */
  private coMoversFor(inst: Instance): string[] {
    if (inst.groupId) return this.groupMemberIds(inst.groupId).filter((id) => id !== inst.id);
    if (this.marqueeIds && this.marqueeIds.length > 1 && this.marqueeIds.includes(inst.id)) {
      return this.marqueeIds.filter((id) => id !== inst.id);
    }
    return [];
  }

  /** Fans a group's members out into a formation instead of a same-random-band clump: evenly spaced
   *  vertical slots around the school's centroid (plus a little jitter so it doesn't look like a
   *  ruler), scaled by member count so a bigger school spreads wider. Re-run whenever membership
   *  changes so a new join gets its own slot and everyone else's stays roughly put. */
  private reflowSchoolOffsets(groupId: string): void {
    const members = this.instances.filter((i) => i.groupId === groupId);
    const spacing = 55;
    members.forEach((m, i) => {
      m.schoolOffsetY = (i - (members.length - 1) / 2) * spacing + (Math.random() - 0.5) * 14;
    });
  }

  /** Drops any group left with fewer than 2 members (after a delete/leave) - the lone survivor,
   *  if any, goes back to swimming solo instead of sitting in a pointless one-member group. */
  private pruneEmptyGroups(): void {
    const counts = new Map<string, number>();
    this.instances.forEach((i) => {
      if (i.groupId) counts.set(i.groupId, (counts.get(i.groupId) || 0) + 1);
    });
    const dissolve = new Set(this.groups.filter((g) => (counts.get(g.id) || 0) < 2).map((g) => g.id));
    if (!dissolve.size) return;
    this.instances.forEach((i) => {
      if (i.groupId && dissolve.has(i.groupId)) i.groupId = null;
    });
    this.groups = this.groups.filter((g) => !dissolve.has(g.id));
    this.persistGroups();
  }

  /** Turns the current marquee selection into a named group; members become one contiguous
   *  z-order block (reinserted at the position the frontmost selected member used to occupy). */
  groupMarquee(): void {
    if (!this.marqueeIds || this.marqueeIds.length < 2) return;
    const ids = new Set(this.marqueeIds);
    const group: TankGroup = { id: storage.uid('group'), name: `Group ${this.groups.length + 1}`, zone: null };
    this.groups.push(group);

    let lastMatchIdx = -1;
    this.instances.forEach((inst, idx) => {
      if (ids.has(inst.id)) lastMatchIdx = idx;
    });
    let anchorId: string | null = null;
    for (let i = lastMatchIdx + 1; i < this.instances.length; i++) {
      if (!ids.has(this.instances[i].id)) {
        anchorId = this.instances[i].id;
        break;
      }
    }

    const members = this.instances.filter((i) => ids.has(i.id));
    members.forEach((i) => (i.groupId = group.id));
    const remaining = this.instances.filter((i) => !ids.has(i.id));
    const insertAt = anchorId ? remaining.findIndex((i) => i.id === anchorId) : -1;
    remaining.splice(insertAt === -1 ? remaining.length : insertAt, 0, ...members);
    this.instances = remaining;
    this.reflowSchoolOffsets(group.id);

    this.marqueeIds = null;
    this.persist();
    this.persistGroups();
  }

  deleteMarquee(): void {
    if (!this.marqueeIds || !this.marqueeIds.length) return;
    this.pushUndo();
    const ids = new Set(this.marqueeIds);
    this.instances = this.instances.filter((i) => !ids.has(i.id));
    this.marqueeIds = null;
    if (this.selectedId && ids.has(this.selectedId)) this.selectedId = null;
    this.pruneEmptyGroups();
    this.persist();
  }

  renameGroup(id: string, name: string): void {
    const group = this.groups.find((g) => g.id === id);
    if (!group) return;
    const trimmed = name.trim();
    if (trimmed) group.name = trimmed;
    this.persistGroups();
  }

  ungroup(id: string): void {
    this.instances.forEach((i) => {
      if (i.groupId === id) i.groupId = null;
    });
    this.groups = this.groups.filter((g) => g.id !== id);
    this.persist();
    this.persistGroups();
  }

  deleteGroup(id: string): void {
    this.pushUndo();
    const removedIds = new Set(this.groupMemberIds(id));
    this.instances = this.instances.filter((i) => i.groupId !== id);
    this.groups = this.groups.filter((g) => g.id !== id);
    if (this.selectedId && removedIds.has(this.selectedId)) this.selectedId = null;
    this.persist();
    this.persistGroups();
  }

  /** The single drag-and-drop entry point for the Layers panel: dropping an instance row onto
   *  another instance row reorders to that slot and inherits its group membership (or leaves any
   *  group, if the target is top-level) - same splice-to-index mechanic as the sprite editor's
   *  LayerPanel.moveLayer. Dropping onto a group's folder header always means "join this group".
   *  Dragging a group header moves its whole member block (groups can't nest, so a group can only
   *  be dropped relative to another row, never "into" one). */
  moveRow(draggedId: string, targetKind: 'group' | 'instance', targetId: string): void {
    const draggedIsGroup = this.groups.some((g) => g.id === draggedId);
    if (draggedIsGroup && targetKind === 'group') return;
    if (!draggedIsGroup && targetKind === 'instance' && targetId === draggedId) return;

    const draggedIds = draggedIsGroup ? this.groupMemberIds(draggedId) : [draggedId];
    if (!draggedIds.length) return;
    const draggedSet = new Set(draggedIds);
    const block = this.instances.filter((i) => draggedSet.has(i.id));
    const remaining = this.instances.filter((i) => !draggedSet.has(i.id));
    const oldGroupId = draggedIsGroup ? draggedId : (block[0]?.groupId ?? null);

    let insertAt: number;
    let newGroupId: string | null;

    if (targetKind === 'group') {
      newGroupId = targetId;
      insertAt = 0;
      remaining.forEach((i, idx) => {
        if (i.groupId === targetId) insertAt = idx + 1;
      });
    } else {
      const idx = remaining.findIndex((i) => i.id === targetId);
      if (idx === -1) return;
      newGroupId = remaining[idx].groupId;
      insertAt = idx;
    }

    if (!draggedIsGroup) block[0].groupId = newGroupId;
    remaining.splice(insertAt, 0, ...block);
    this.instances = remaining;

    if (!draggedIsGroup && oldGroupId !== newGroupId) {
      this.pruneEmptyGroups();
      if (newGroupId) this.reflowSchoolOffsets(newGroupId);
    }
    this.persist();
    this.persistGroups();
  }

  removeInstance(id: string): void {
    this.pushUndo();
    this.instances = this.instances.filter((inst) => inst.id !== id);
    this.pruneEmptyGroups();
    this.persist();
  }

  selectInstance(id: string | null): void {
    this.selectedId = id;
    if (id) this.marqueeIds = null;
    this.selectedRoomId = null;
    this.reactNotify();
  }

  /** Shift-click multi-select from the Layers panel - adds/removes `ids` from the same `marqueeIds`
   *  a canvas rectangle-select would produce, so the existing Group/Delete floating bar and the
   *  yellow canvas highlight just work for panel-driven selection too. Toggles as one block: if
   *  every id is already selected, they're all removed; otherwise they're all added (this is how a
   *  shift-click on a group's folder row selects/deselects the whole group in one click). */
  toggleMarqueeSelect(ids: string[]): void {
    if (!ids.length) return;
    const current = new Set(this.marqueeIds ?? []);
    const allSelected = ids.every((id) => current.has(id));
    ids.forEach((id) => (allSelected ? current.delete(id) : current.add(id)));
    this.marqueeIds = current.size ? Array.from(current) : null;
    this.selectedId = null;
    this.selectedRoomId = null;
    this.reactNotify();
  }

  removeSelected(): void {
    if (this.selectedId) this.removeInstance(this.selectedId);
    this.selectInstance(null);
  }

  private moveBlockToFront(ids: string[]): void {
    const idSet = new Set(ids);
    const block = this.instances.filter((i) => idSet.has(i.id));
    if (!block.length) return;
    this.instances = this.instances.filter((i) => !idSet.has(i.id));
    this.instances.push(...block);
    this.persist();
  }

  private moveBlockToBack(ids: string[]): void {
    const idSet = new Set(ids);
    const block = this.instances.filter((i) => idSet.has(i.id));
    if (!block.length) return;
    this.instances = this.instances.filter((i) => !idSet.has(i.id));
    this.instances.unshift(...block);
    this.persist();
  }

  bringToFront(id: string): void {
    const inst = this.instances.find((i) => i.id === id);
    if (!inst) return;
    this.moveBlockToFront(inst.groupId ? this.groupMemberIds(inst.groupId) : [id]);
  }

  sendToBack(id: string): void {
    const inst = this.instances.find((i) => i.id === id);
    if (!inst) return;
    this.moveBlockToBack(inst.groupId ? this.groupMemberIds(inst.groupId) : [id]);
  }

  private hitTest(x: number, y: number): Instance | null {
    for (let i = this.instances.length - 1; i >= 0; i--) {
      const inst = this.instances[i];
      const sprite = this.spriteFor(inst);
      if (!sprite) continue;
      const { pw, ph } = this.spritePx(sprite);
      if (x >= inst.x && x <= inst.x + pw && y >= inst.y && y <= inst.y + ph) return inst;
    }
    return null;
  }

  onCanvasPointerDown(e: React.PointerEvent<HTMLCanvasElement>): void {
    const canvas = this.canvas;
    if (!canvas) return;

    const p = this.canvasPoint(e.clientX, e.clientY);
    if (!p) return;
    const { x, y } = p;

    if (this.zoneDraftTarget) {
      this.zoneDrawStart = { x, y };
      this.zoneDraftRect = { x0: x, y0: y, x1: x, y1: y };
      canvas.setPointerCapture(e.pointerId);
      this.reactNotify();
      return;
    }

    const inst = this.hitTest(x, y);
    if (!inst) {
      this.selectInstance(null);
      this.marqueeIds = null;
      this.marqueeRect = null;
      this.marqueeStart = { x, y };
      this.marqueeActive = false;
      canvas.setPointerCapture(e.pointerId);
      this.reactNotify();
      return;
    }
    // Dragging a member of the current multi-selection moves the whole selection together, so keep
    // it intact instead of collapsing to just this one instance - clicking anything else (or just
    // tapping without dragging - see onCanvasPointerUp) still clears it as before.
    const partOfMarquee = !!this.marqueeIds && this.marqueeIds.length > 1 && this.marqueeIds.includes(inst.id);
    if (!partOfMarquee) {
      this.marqueeIds = null;
      this.marqueeRect = null;
    }
    // Selecting/dragging never reorders `instances` (that would jump the row to the top of the
    // Layers panel just from clicking it) - draw() renders whatever's being dragged on top instead,
    // purely visually. Z-order only changes via bring-to-front/send-to-back or a panel drag-reorder.
    inst.isDragging = true;
    this.draggingInstance = inst;
    this.dragOffset = { x: x - inst.x, y: y - inst.y };
    this.dragStart = { x, y };
    this.dragMoved = false;
    // Captured now, committed to the undo stack on release only if this turns into an actual move
    // (see onCanvasPointerUp) - so a plain click-to-select never pollutes the undo history.
    this.dragUndoSnapshot = this.snapshotState();
    canvas.setPointerCapture(e.pointerId);
    this.reactNotify();
  }

  private updateMarquee(e: React.PointerEvent<HTMLCanvasElement>): void {
    if (!this.marqueeStart) return;
    const p = this.canvasPoint(e.clientX, e.clientY);
    if (!p) return;
    const { x, y } = p;
    if (!this.marqueeActive) {
      if (Math.hypot(x - this.marqueeStart.x, y - this.marqueeStart.y) < TAP_MOVE_THRESHOLD) return;
      this.marqueeActive = true;
    }
    const x0 = Math.min(this.marqueeStart.x, x);
    const x1 = Math.max(this.marqueeStart.x, x);
    const y0 = Math.min(this.marqueeStart.y, y);
    const y1 = Math.max(this.marqueeStart.y, y);
    this.marqueeRect = { x0, y0, x1, y1 };
    this.marqueeIds = this.instances
      .filter((inst) => {
        const { pw, ph } = this.spritePx(this.spriteFor(inst));
        return inst.x < x1 && inst.x + pw > x0 && inst.y < y1 && inst.y + ph > y0;
      })
      .map((inst) => inst.id);
    this.reactNotify();
  }

  onCanvasPointerMove(e: React.PointerEvent<HTMLCanvasElement>): void {
    if (this.zoneDrawStart) {
      const p = this.canvasPoint(e.clientX, e.clientY);
      if (!p) return;
      this.zoneDraftRect = {
        x0: Math.min(this.zoneDrawStart.x, p.x),
        y0: Math.min(this.zoneDrawStart.y, p.y),
        x1: Math.max(this.zoneDrawStart.x, p.x),
        y1: Math.max(this.zoneDrawStart.y, p.y),
      };
      this.reactNotify();
      return;
    }
    if (this.marqueeStart) {
      this.updateMarquee(e);
      return;
    }
    if (!this.draggingInstance || !this.canvas) return;
    const p = this.canvasPoint(e.clientX, e.clientY);
    if (!p) return;
    const { x, y } = p;
    if (Math.hypot(x - this.dragStart.x, y - this.dragStart.y) > TAP_MOVE_THRESHOLD) this.dragMoved = true;
    const inst = this.draggingInstance;
    const { pw, ph } = this.spritePx(this.spriteFor(inst));
    const prevX = inst.x;
    const prevY = inst.y;
    const rawX = Math.min(Math.max(0, x - this.dragOffset.x), this.canvas.width - pw);
    const rawY = Math.min(Math.max(0, y - this.dragOffset.y), this.canvas.height - ph);
    const clamped = this.clampTopLeftToShape(rawX, rawY, pw, ph, this.canvas.width, this.canvas.height);
    inst.x = clamped.x;
    inst.y = clamped.y;

    const coMovers = this.coMoversFor(inst);
    if (coMovers.length) {
      const dx = inst.x - prevX;
      const dy = inst.y - prevY;
      if (dx !== 0 || dy !== 0) {
        const coMoverSet = new Set(coMovers);
        this.instances.forEach((other) => {
          if (!coMoverSet.has(other.id)) return;
          const { pw: opw, ph: oph } = this.spritePx(this.spriteFor(other));
          const ox = Math.min(Math.max(0, other.x + dx), this.canvas!.width - opw);
          const oy = Math.min(Math.max(0, other.y + dy), this.canvas!.height - oph);
          const oclamped = this.clampTopLeftToShape(ox, oy, opw, oph, this.canvas!.width, this.canvas!.height);
          other.x = oclamped.x;
          other.y = oclamped.y;
        });
      }
    }
  }

  onCanvasPointerUp(): void {
    if (this.zoneDrawStart) {
      this.zoneDrawStart = null;
      const r = this.zoneDraftRect;
      const target = this.zoneDraftTarget;
      this.zoneDraftRect = null;
      this.zoneDraftTarget = null;
      if (r && target && r.x1 - r.x0 > 10 && r.y1 - r.y0 > 10) this.applyZone(target, r);
      this.reactNotify();
      return;
    }
    if (this.marqueeStart) {
      this.marqueeStart = null;
      this.marqueeActive = false;
      this.marqueeRect = null;
      if (this.marqueeIds && this.marqueeIds.length === 0) this.marqueeIds = null;
      this.reactNotify();
      return;
    }
    if (!this.draggingInstance) {
      this.dragUndoSnapshot = null;
      return;
    }
    const inst = this.draggingInstance;
    inst.isDragging = false;

    if (!this.dragMoved) {
      // Just a click, nothing actually moved - nothing to record.
      this.dragUndoSnapshot = null;
      this.selectInstance(inst.id);
    } else {
      if (this.dragUndoSnapshot) this.commitUndo(this.dragUndoSnapshot);
      this.dragUndoSnapshot = null;
      this.selectInstance(null);
    }
    this.draggingInstance = null;
    this.persist();
  }

  startPaletteDrag(e: React.PointerEvent<HTMLDivElement>, spriteId: string): void {
    e.preventDefault();
    const sprite = this.sprites.find((s) => s.id === spriteId);
    if (!sprite) return;

    const { pw, ph } = this.spritePx(sprite);
    const ghost = document.createElement('canvas');
    ghost.width = pw;
    ghost.height = ph;
    ghost.className = 'palette-ghost';
    const gctx = ghost.getContext('2d')!;
    const { width, height } = this.spriteDims(sprite);
    paintLayers(gctx, sprite.frames[0], width, height, DISPLAY_SCALE);
    document.body.appendChild(ghost);
    this.paletteGhost = ghost;
    this.paletteGhostPx = { pw, ph };
    this.paletteDragSpriteId = spriteId;
    this.movePaletteGhost(e.clientX, e.clientY);

    const move = (ev: PointerEvent) => this.movePaletteGhost(ev.clientX, ev.clientY);
    const up = (ev: PointerEvent) => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      this.finishPaletteDrag(ev.clientX, ev.clientY);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  private movePaletteGhost(clientX: number, clientY: number): void {
    if (!this.paletteGhost) return;
    const { pw, ph } = this.paletteGhostPx;
    this.paletteGhost.style.left = `${clientX - pw / 2}px`;
    this.paletteGhost.style.top = `${clientY - ph / 2}px`;
  }

  private finishPaletteDrag(clientX: number, clientY: number): void {
    if (this.paletteGhost) {
      this.paletteGhost.remove();
      this.paletteGhost = null;
    }
    const spriteId = this.paletteDragSpriteId;
    this.paletteDragSpriteId = null;
    if (!spriteId) return;
    const sprite = this.sprites.find((s) => s.id === spriteId);

    // 'room' sprites drop anywhere in the viewport (the area around the tank, including on top of
    // the frame) instead of only onto the tank canvas itself - see addRoomInstance.
    if (sprite?.type === 'room') {
      if (!this.viewportEl) return;
      const rect = this.viewportEl.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        this.addRoomInstance(spriteId, clientX, clientY);
      }
      return;
    }

    if (this.canvas) {
      const rect = this.canvas.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        const p = this.canvasPoint(clientX, clientY);
        if (p) this.addInstance(spriteId, p.x, p.y);
      }
    }
  }

  private update(dt: number): void {
    if (!this.canvas || !this.hasSized) return;

    // Schooling: fish belonging to a user-made group (see TankGroup) flock together, whatever their
    // species - the user picked those members deliberately via the marquee-select + Group action.
    // Each group steers toward a common heading and a common vertical centroid instead of each fish
    // wandering independently. Computed once per frame from last frame's positions; good enough
    // since it's just a steering target. Decorations in the group simply never enter the fish branch
    // below, so they're unaffected by schooling but still move together (see onCanvasPointerMove).
    const schoolsByGroup = new Map<string, Instance[]>();
    this.instances.forEach((inst) => {
      if (inst.kind !== 'fish' || !inst.groupId || inst.isDragging) return;
      const list = schoolsByGroup.get(inst.groupId);
      if (list) list.push(inst);
      else schoolsByGroup.set(inst.groupId, [inst]);
    });
    const schoolSteer = new Map<string, { dir: 1 | -1; centerY: number }>();
    schoolsByGroup.forEach((members, groupId) => {
      if (members.length < 2) return;
      const dir: 1 | -1 = members.reduce((sum, inst) => sum + inst.dir, 0) >= 0 ? 1 : -1;
      const centerY = members.reduce((sum, inst) => sum + inst.y, 0) / members.length;
      schoolSteer.set(groupId, { dir, centerY });
    });

    this.instances.forEach((inst) => {
      const sprite = this.spriteFor(inst);
      if (!sprite) return;
      inst.frameTimer += dt;
      const frameInterval = (sprite.frameMs || storage.DEFAULT_FRAME_MS) / 1000;
      if (inst.frameTimer >= frameInterval) {
        inst.frameTimer = 0;
        inst.frameIndex = (inst.frameIndex + 1) % sprite.frames.length;
      }
      if (inst.isDragging) return;
      inst.bobPhase += dt * 2;
      if (inst.kind === 'fish') {
        if (inst.vy === undefined) inst.vy = 6 + Math.random() * 12;
        if (inst.targetY === undefined) inst.targetY = this.randomTargetY(this.spritePx(sprite).ph);
        if (inst.schoolOffsetY === undefined) inst.schoolOffsetY = (Math.random() - 0.5) * 40;

        const bounds = this.swimBoundsFor(inst);
        const steer = inst.groupId ? schoolSteer.get(inst.groupId) : undefined;
        const schooling = !!steer;
        if (steer) {
          inst.dir = steer.dir;
          inst.targetY = Math.max(bounds.yMin, Math.min(bounds.yMax, steer.centerY + inst.schoolOffsetY));
        }

        // Clamp first in case the zone shrank (or moved) since last frame and this fish is now
        // outside it - otherwise it'd sail straight past the new wall before ever "bouncing".
        inst.x = Math.min(Math.max(inst.x, bounds.xMin), bounds.xMax);
        inst.x += inst.vx * inst.dir * dt;
        if (inst.x <= bounds.xMin) {
          inst.x = bounds.xMin;
          inst.dir = 1;
          if (!schooling) inst.targetY = this.randomTargetYInBounds(bounds.yMin, bounds.yMax);
        }
        if (inst.x >= bounds.xMax) {
          inst.x = bounds.xMax;
          inst.dir = -1;
          if (!schooling) inst.targetY = this.randomTargetYInBounds(bounds.yMin, bounds.yMax);
        }

        const dy = inst.targetY - inst.y;
        if (Math.abs(dy) < 2) {
          if (!schooling) inst.targetY = this.randomTargetYInBounds(bounds.yMin, bounds.yMax);
        } else {
          inst.y += Math.sign(dy) * Math.min(Math.abs(dy), inst.vy * dt);
        }

        // The rectangular `bounds` above (zone, sand strip, canvas edges) don't know about a
        // non-rectangular tank shape's corner/edge cut - refine against it last so a fish heading
        // into a rounded/oval corner bounces off the actual visible glass instead of swimming
        // halfway into it. A no-op for 'rectangle' (clampCenterToShape degrades to the same edge
        // clamp bounds already enforced), so skipped there to avoid the extra work every frame.
        if (this.tankShape !== 'rectangle') {
          const { pw, ph } = this.spritePx(sprite);
          const refined = this.clampTopLeftToShape(inst.x, inst.y, pw, ph, this.canvas!.width, this.canvas!.height);
          if (refined.moved) {
            inst.x = refined.x;
            inst.y = refined.y;
            inst.dir = inst.dir === 1 ? -1 : 1;
            if (!schooling) inst.targetY = this.randomTargetYInBounds(bounds.yMin, bounds.yMax);
          }
        }
      }
    });
  }

  /** Returns an offscreen canvas holding bgSprite painted at dw×dh (see the bgCache* fields' doc
   *  comment for the invalidation rule), redrawing via the same per-cell paintLayers() the on-canvas
   *  path used to run every frame only when actually stale. `canvas.width =`/`height =` clears the
   *  backing store as a side effect even when set to its current value, so that's only touched on an
   *  actual size change; a same-size redraw (sprite swapped for one of identical footprint, or a live
   *  pixel edit re-saved at the same scale) instead clears via clearRect - either way the cache is
   *  fully repainted before use, never partially. */
  private getBackgroundCache(sprite: Sprite, sw: number, sh: number, cellPx: number, dw: number, dh: number): HTMLCanvasElement {
    const width = Math.max(1, Math.round(dw));
    const height = Math.max(1, Math.round(dh));
    const stale =
      this.bgCacheSpriteRef !== sprite ||
      this.bgCacheScale !== this.backgroundTransform.scale ||
      !this.bgCacheCanvas ||
      this.bgCacheCanvas.width !== width ||
      this.bgCacheCanvas.height !== height;

    if (!this.bgCacheCanvas) {
      this.bgCacheCanvas = document.createElement('canvas');
      this.bgCacheCtx = this.bgCacheCanvas.getContext('2d');
    }
    if (!stale) return this.bgCacheCanvas;

    if (this.bgCacheCanvas.width !== width) this.bgCacheCanvas.width = width;
    if (this.bgCacheCanvas.height !== height) this.bgCacheCanvas.height = height;
    if (this.bgCacheCtx) {
      this.bgCacheCtx.clearRect(0, 0, width, height);
      paintLayers(this.bgCacheCtx, sprite.frames[0], sw, sh, cellPx);
    }
    this.bgCacheSpriteRef = sprite;
    this.bgCacheScale = this.backgroundTransform.scale;
    return this.bgCacheCanvas;
  }

  private drawBackground(): void {
    if (!this.canvas || !this.ctx) return;
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // The gradient is always the base layer - a background sprite is placed freely (see
    // BackgroundTransform) rather than forced to cover the whole tank, so whatever it doesn't cover
    // still needs to read as water rather than as a transparent hole.
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#7fd7e8');
    grad.addColorStop(1, '#0f6f97');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    const bgSprite = this.backgroundSpriteId
      ? this.sprites.find((s) => s.id === this.backgroundSpriteId && s.type === 'background')
      : null;
    if (bgSprite) {
      const { width: sw, height: sh } = this.spriteDims(bgSprite);
      const cellPx = DISPLAY_SCALE * this.backgroundTransform.scale;
      const dw = sw * cellPx;
      const dh = sh * cellPx;
      const cache = this.getBackgroundCache(bgSprite, sw, sh, cellPx, dw, dh);
      ctx.save();
      ctx.translate(this.backgroundTransform.x, this.backgroundTransform.y);
      ctx.rotate(this.backgroundTransform.rotation);
      ctx.translate(-dw / 2, -dh / 2);
      ctx.drawImage(cache, 0, 0);
      ctx.restore();
    }

    // A bright waterline band right at the top - the glassy "surface glint" seen in reference tank
    // art, distinguishing the water's top edge from the glass/lid above it.
    const waterlineH = Math.max(3, h * 0.02);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(0, 0, w, waterlineH);
  }

  private drawInstance(inst: Instance): void {
    if (!inst.visible) return;
    const sprite = this.spriteFor(inst);
    if (!sprite || !this.ctx) return;
    const { width, height } = this.spriteDims(sprite);
    const { pw, ph } = this.spritePx(sprite);
    const layers = sprite.frames[inst.frameIndex % sprite.frames.length];
    const renderY = inst.y + (inst.kind === 'fish' && !inst.isDragging ? Math.sin(inst.bobPhase) * 3 : 0);

    this.ctx.save();
    this.ctx.translate(inst.x + pw / 2, renderY + ph / 2);
    if (inst.kind === 'fish' && inst.dir < 0) this.ctx.scale(-1, 1);
    this.ctx.translate(-pw / 2, -ph / 2);
    paintLayers(this.ctx, layers, width, height, DISPLAY_SCALE);
    this.ctx.restore();

    if (inst.id === this.selectedId || this.marqueeIds?.includes(inst.id)) {
      this.ctx.strokeStyle = '#ffeb3b';
      this.ctx.lineWidth = 2;
      this.ctx.strokeRect(inst.x - 2, renderY - 2, pw + 4, ph + 4);
    }
  }

  private strokeZoneRect(zone: SelectionBox, color: string, fill?: string): void {
    if (!this.ctx) return;
    const { x0, y0, x1, y1 } = zone;
    this.ctx.save();
    if (fill) {
      this.ctx.fillStyle = fill;
      this.ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 1.5;
    this.ctx.setLineDash([6, 4]);
    this.ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    this.ctx.restore();
  }

  /** The tank's swim-area silhouette as a canvas path, for the draw-time clip - see TankShape and
   *  clampCenterToShape (which must agree with this on where the shape's edge actually is). */
  private shapePath(w: number, h: number): Path2D {
    const p = new Path2D();
    if (this.tankShape === 'oval') {
      const cx = w / 2;
      const cy = h / 2;
      const rx = Math.max(0, w / 2);
      const ry = Math.max(0, h / 2);
      const t = Math.max(OVAL_TOP_CUT_MIN, Math.min(OVAL_TOP_CUT_MAX, this.tankOvalTopCutFrac));
      if (t <= 0.001 || ry <= 0) {
        p.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      } else {
        // Slices the top off the ellipse at y = h*t with a flat line, keeping the rest of the
        // boundary as-is - see clampCenterToShape's oval branch for the (approximate) physics
        // counterpart. `s` is the cut line's height expressed as sin(theta) on the ellipse
        // parametrization, i.e. where y = cy + ry*sin(theta); solving for the two x/theta values
        // where that horizontal line crosses the ellipse gives the flat edge's endpoints.
        const s = Math.max(-0.999, Math.min(0.999, 2 * t - 1));
        const thetaRight = Math.asin(s);
        const thetaLeft = Math.PI - thetaRight;
        const topCutY = cy + ry * s;
        const xRight = cx + rx * Math.cos(thetaRight);
        const xLeft = cx - rx * Math.cos(thetaRight);
        p.moveTo(xLeft, topCutY);
        p.lineTo(xRight, topCutY);
        p.ellipse(cx, cy, rx, ry, 0, thetaRight, thetaLeft, false);
        p.closePath();
      }
    } else if (this.tankShape === 'rounded') {
      const r = Math.max(0, Math.min(this.shapeCornerRadius(w, h), w / 2, h / 2));
      p.moveTo(r, 0);
      p.arcTo(w, 0, w, h, r);
      p.arcTo(w, h, 0, h, r);
      p.arcTo(0, h, 0, 0, r);
      p.arcTo(0, 0, w, 0, r);
      p.closePath();
    } else {
      p.rect(0, 0, w, h);
    }
    return p;
  }

  private draw(): void {
    if (!this.ctx || !this.canvas) return;
    const ctx = this.ctx;

    // clip() can only ever shrink the paintable region for the rest of this call - it can't erase
    // pixels a previous frame already painted outside a since-shrunk shape (e.g. dragging the
    // corner-radius/oval-cut sliders, or switching shape), so without this clear those stale pixels
    // just sit there forever until something else (like a resize) happens to wipe the canvas.
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.save();
    ctx.clip(this.shapePath(this.canvas.width, this.canvas.height));

    this.drawBackground();

    if (this.selectedZone) this.strokeZoneRect(this.selectedZone, 'rgba(120, 255, 160, 0.9)');

    // Draw order follows `instances` (z-order) as-is - EXCEPT whatever's actively being dragged (and
    // anything moving with it - its group, or the rest of a multi-selection) gets drawn last so it
    // visually sits on top while moving, without ever touching the persisted array order (a mere
    // click/drag must not reorder anything or jump rows around in the Layers panel - only explicit
    // bring-to-front/send-to-back/panel-reorder should).
    const raised = this.draggingInstance
      ? new Set([this.draggingInstance.id, ...this.coMoversFor(this.draggingInstance)])
      : null;
    if (raised) {
      this.instances.forEach((inst) => {
        if (!raised.has(inst.id)) this.drawInstance(inst);
      });
      this.instances.forEach((inst) => {
        if (raised.has(inst.id)) this.drawInstance(inst);
      });
    } else {
      this.instances.forEach((inst) => this.drawInstance(inst));
    }

    if (this.marqueeRect) this.strokeZoneRect(this.marqueeRect, '#ffeb3b', 'rgba(255, 235, 59, 0.15)');
    if (this.zoneDraftRect) this.strokeZoneRect(this.zoneDraftRect, '#4ade80', 'rgba(74, 222, 128, 0.15)');

    ctx.restore();

    // Drawn last, outside the clip above - a stroke centered on the shape path needs half of its
    // width to fall *outside* the clipped water to read as a bold pixel-art glass outline (rather
    // than a thin inner line), matching the reference bowl/tank art's chunky border.
    ctx.save();
    ctx.lineWidth = TANK_OUTLINE_WIDTH;
    ctx.strokeStyle = TANK_OUTLINE_COLOR;
    // The oval's flattened-top corner (see shapePath) meets the ellipse curve at a very sharp angle -
    // the default miter join would spike that corner's stroke out into a long stray diagonal line.
    ctx.lineJoin = 'round';
    ctx.stroke(this.shapePath(this.canvas.width, this.canvas.height));
    ctx.restore();
  }

  private loop(t: number): void {
    const dt = this.lastTime ? Math.min(0.05, (t - this.lastTime) / 1000) : 0;
    this.lastTime = t;
    this.update(dt);
    this.draw();
    this.rafId = requestAnimationFrame((nt) => this.loop(nt));
  }
}

export function useTank() {
  const engineRef = useRef<TankEngine | null>(null);
  const [, setTick] = useState(0);
  if (!engineRef.current) {
    engineRef.current = new TankEngine();
  }
  const engine = engineRef.current;

  useEffect(() => {
    engine.init(() => setTick((t) => t + 1));
    engine.resizeCanvas();
    engine.refreshPalette();
    const onResize = () => engine.resizeCanvas();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      engine.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return engine;
}

export type { TankEngine };
