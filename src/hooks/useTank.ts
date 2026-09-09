import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { CAT_VARIANTS } from '@/lib/data/pixellabPack';
import { t } from '@/lib/i18n';
import { pixelateImageFile } from '@/lib/imageImport';
import { SceneExport } from '@/tank/export/sceneExport';
import { decayHunger, decayWaterLevel, growAlgae } from '@/tank/sim/vitals';
import { computeSchoolSteer, type SchoolSteer } from '@/tank/sim/schooling';
// Re-exported, not redefined: useTank.test.ts and the Life panel have always imported these two
// from here.
export { HUNGER_FULL_TO_EMPTY_MS, STARVATION_DEATH_MS } from '@/tank/sim/vitals';
import { paintLayers, spriteDims } from '@/lib/pixelMath';
import { getRepos, type TankState, type TankSummary } from '@/lib/data';
import * as storage from '@/lib/storage';
import {
  clampTopLeftToShape as clampTopLeftToShapePure,
  OVAL_TOP_CUT_MAX,
  OVAL_TOP_CUT_MIN,
  ovalFlatTopGeometry,
  ROUNDED_RADIUS_MAX,
  ROUNDED_RADIUS_MIN,
  roundedCornerRadius,
} from '@/tank/sim/geometry';
import { type AlgaePatch, generateAlgaePatches } from '@/tank/sim/algae';
import type { BackgroundTransform, FoodItem, Instance, PredatorEvent, PredatorPhase, RoomInstance, SelectionBox, Sprite, SwimSpeed, TankGroup, TankShape, WasteItem } from '@/lib/types';

/** Re-exported from geometry.ts (their canonical home as of P3 - see docs/PIXI_MIGRATION_PLAN.md) so
 *  existing `from '@/hooks/useTank'` import sites (TankCanvas.tsx's shape sliders) didn't need to
 *  change. Slider ranges for the two shape-specific knobs below - see TankEngine.tankCornerRadiusFrac
 *  and tankOvalTopCutFrac. Capped well short of 0.5 so the shape can't invert/degenerate into nothing. */
export { ROUNDED_RADIUS_MIN, ROUNDED_RADIUS_MAX, OVAL_TOP_CUT_MIN, OVAL_TOP_CUT_MAX };

const DISPLAY_SCALE = 4;
const TAP_MOVE_THRESHOLD = 6;
/** Matches index.css's --tank-outline - the bold pixel-art border TankEngine.draw() strokes around
 *  the tank's own shape, independent of the active UI theme (same rationale as the CSS var: real
 *  aquarium glass doesn't recolor to match a cotton-candy desk skin). */
const TANK_OUTLINE_COLOR = '#1c2436';
const TANK_OUTLINE_WIDTH = 5;

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

/** P5 §6 item 2 (hunger + feeding, docs/PIXI_MIGRATION_PLAN.md) balance constants. A full-to-empty
 *  hunger decay of 1 real day means a fish left completely unfed needs feeding roughly daily to stay
 *  above 0; §9 Q2's "4 days unfed = dead" then gives a comfortable grace window on top of that, not a
 *  hair-trigger one. */
/** ~3 pellets to refill an empty fish - keeps feeding a repeated small interaction rather than one
 *  click maxing hunger out for a day. */
export const FOOD_HUNGER_GAIN = 0.34;
const FOOD_FALL_SPEED = 22;
/** Close enough that a pellet visibly touching the fish's sprite counts as eaten, not just "nearby". */
const FOOD_EAT_RADIUS = 28;
/** How far past the food a fish has to drift, horizontally, before it corrects course back toward it -
 *  see the food-seeking hysteresis comment in update(). Deliberately larger than FOOD_EAT_RADIUS so a
 *  fish that's already within eating distance never re-triggers a direction flip on its way in. */
const FOOD_SEEK_DEADZONE = 36;

/** P5 §6 item 3 (waste + collect, docs/PIXI_MIGRATION_PLAN.md) balance constants. */
const POOP_DELAY_MIN_MS = 5_000;
const POOP_DELAY_MAX_MS = 15_000;
const WASTE_FALL_SPEED = 16;
const WASTE_COLLECT_RADIUS = 26;
/** tankCleanliness reaches 0 once this many waste items are sitting uncollected - not a hard cap on
 *  how much waste can actually exist, just where the readout bottoms out. */
const WASTE_MAX_FOR_ZERO_QUALITY = 8;

/** How much total scrub distance (px, summed across a drag) it takes to clean the glass from fully
 *  algae-covered back to spotless - calibrated to a few full-width swipes of the tank, not one wipe
 *  (scrubbing should read as an actual chore, if a quick one). */
const ALGAE_SCRUB_PX_TO_CLEAN = 1500;

const DAY_MS = 24 * 60 * 60 * 1000;

/** P5 §6 item 6 (breeding, docs/PIXI_MIGRATION_PLAN.md §9 Q4/§9.1). A day-by-day random chance, evaluated
 *  continuously (see tickBreeding()) rather than as a once-a-day roll, so it isn't tied to any particular
 *  moment the app happens to be open - a tank left running for exactly one day sees ~BREEDING_DAILY_CHANCE
 *  odds of one birth, same as the design called for. */
const BREEDING_DAILY_CHANCE = 0.1;
/** The chance above is scaled down as the tank fills up (`* max(0, 1 - fishCount/this)`), reaching 0 at
 *  this population - keeps breeding from compounding into unbounded exponential growth once the tank is
 *  already crowded, per §9.1's own reasoning. */
const BREEDING_POPULATION_CAP = 12;
/** A fish only counts toward breeding eligibility once its hunger has stayed above 0.5 for this long
 *  continuously (see wellFedSince) - per §9 Q4's "ต้องกินอิ่มมา ≥1 วันติดก่อน", keeps breeding from firing
 *  the moment a starving tank gets one meal. */
const WELL_FED_MIN_MS = DAY_MS;
/** How long a bred fish takes to reach full size - see growthScale(). */
const BABY_MATURATION_MS = 3 * DAY_MS;
/** A newborn renders at this fraction of adult size, growing linearly to 1 by BABY_MATURATION_MS - see
 *  growthScale()'s own doc comment for why this only affects rendered size, not swim-bounds footprint.
 *  Matches §9 Q4's "16×16 → 8×8" (half size). */
const BABY_SCALE_FRAC = 0.5;
/** How far (tank-logical px) a newborn appears from its parent, before being clamped into the tank's
 *  actual swim bounds like any other placement. */
const BABY_SPAWN_OFFSET = 24;

/** P5 §6 item 7 (predator, docs/PIXI_MIGRATION_PLAN.md §9 Q6). Originally a 20% roll on each app
 *  load, which meant most sessions never saw a cat do anything at all. Now the cats are always
 *  there asleep and simply get hungry: a raid is scheduled for a random moment inside a window, and
 *  another is scheduled when that one ends. The randomness decides *when* a cat gets hungry, not
 *  whether a cat exists.
 *
 *  The first window is short so a session that opens and watches for a minute sees one; the ones
 *  after it are much longer, because a cat at the glass every half minute stops being an event. */
const PREDATOR_FIRST_HUNGER_MS: readonly [number, number] = [20_000, 45_000];
const PREDATOR_NEXT_HUNGER_MS: readonly [number, number] = [90_000, 180_000];

/** A uniform pick inside an inclusive [min, max] millisecond window. */
function randomBetween([min, max]: readonly [number, number]): number {
  return min + Math.random() * (max - min);
}
/** How long the predator lingers before successfully grabbing a fish if not scared off in time.
 *  This is the pounce phase alone - the approach and the stalk before it are extra warning on top,
 *  not part of the deadline. */
const PREDATOR_REACT_MS = 6_000;
/** Room widths per second the cat covers on foot. Slow enough that a player who looks up mid-walk
 *  still has time to react, rather than the cat teleporting to the glass. */
const PREDATOR_WALK_FRAC_PER_S = 0.09;
/** How long the cat sits staring at the tank before it pounces. The second of the two warnings. */
const PREDATOR_STALK_MS = 3_500;
/** How long a scared cat stays on screen running off, and how long a successful one stays to eat.
 *  Both end with the cat simply gone - there is no walk back to its sleeping spot to animate. */
const PREDATOR_FLEE_MS = 2_200;
const PREDATOR_FEAST_MS = 3_000;
/** Where beside the tank the cat settles to stalk and pounce from, as a fraction of the room
 *  artwork's width. Two spots, one each side, so the raid does not always come from the same
 *  direction; the cat starts from whichever edge is further away and walks in. */
const PREDATOR_TANK_SIDES = [0.34, 0.66] as const;

/** Matches tankScene.ts's Pixi version exactly - see the hunger-bar comment in drawInstance(). */
const HUNGER_BAR_HEIGHT = 4;
const HUNGER_BAR_GAP = 4;

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

/**
 * Where a tank's contents come from. There are two: this browser's own storage (the default), and a
 * tank someone else shared, fetched over the network and never written down (see lib/data/sharing.ts).
 *
 * The seam is here rather than inside the repositories because the difference is not *where* the data
 * is stored, it is whether it is the user's at all - and that difference has to reach `readOnly`,
 * which is enforced by the engine, not by storage.
 */
export interface TankSource {
  load(): Promise<{ tankId: string; sprites: Sprite[]; state: TankState }>;
}

export interface TankEngineOptions {
  source?: TankSource;
  /** Nothing this engine holds may be written back - it is not the viewer's tank. Only ever set
   *  together with a `source` that is not local storage. */
  readOnly?: boolean;
}

/** The default: this browser's own library and current tank. */
function localTankSource(): TankSource {
  return {
    async load() {
      const { sprites: spriteRepo, tank: tankRepo } = getRepos();
      await spriteRepo.hydrate();
      const tankId = await tankRepo.currentId();
      return { tankId, sprites: spriteRepo.list(), state: await tankRepo.load(tankId) };
    },
  };
}

/** Exported for unit tests (src/hooks/__tests__/useTank.test.ts) - app code gets its instance from
 *  the `useTank()` hook, never constructs one directly. */
export class TankEngine {
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

  /** Food pellets dropped by the user (see feedAt, P5 §6 item 2) - fall slowly through the water until
   *  a hungry fish reaches one and eats it (see the food-seeking branch in update()). Purely transient
   *  simulation state, like fish swim positions between saves - never written to localStorage, so a
   *  reload always starts with an empty tank of food regardless of what was falling when the tab was
   *  last open. */
  foodItems: FoodItem[] = [];

  /** Fish waste (P5 §6 item 3) - appears a short delay after a fish eats (see poopDueAt below), settles
   *  near the tank floor, and dirties the water (see tankCleanliness) until collected by clicking it.
   *  Transient like foodItems - never written to localStorage. */
  wasteItems: WasteItem[] = [];
  /** Fish id -> epoch ms it's due to poop, scheduled by eatFood() - checked once per frame in update().
   *  Not persisted (in-memory only, like foodItems/wasteItems) - a reload simply cancels any pending
   *  poop rather than trying to resume it, which is harmless since it's just flavor timing, not
   *  anything the 4-day-starvation-style correctness guarantees apply to. */
  private poopDueAt = new Map<string, number>();

  /** Wall-clock timestamp (epoch ms) hunger/starvation was last resolved up to - see tickHunger(). Set
   *  from storage on init() (falling back to "now", i.e. no catch-up, the first time this ever runs)
   *  and refreshed on every save() so the next load's catch-up only has to cover real closed-app time,
   *  not the entire history back to when this field was introduced. */
  private lastTickAt = 0;

  /** 1 (full) .. 0 (empty) - evaporates over real time (P5 §6 item 4, see tickWaterLevel()), caught up
   *  from the same lastTickAt checkpoint hunger uses, and restored to 1 by the Life-mode refill button
   *  (refillWater()). Shrinks the fish-swimmable area from the top as it drops (see swimBoundsFor) and
   *  visibly lowers the water's surface in both renderers - unlike hunger, nothing dies from this yet
   *  (no water-quality-driven health exists until items 4's water and 5's algae are combined - see
   *  tankCleanliness's own doc comment), so a fully evaporated tank is just cramped, not lethal. */
  waterLevel = 1;

  /** 0 (spotless glass) .. 1 (fully covered) - grows over real time, faster the more uncollected waste
   *  is sitting in the tank right now (see tickAlgae()), shrinks when the user scrubs it in Life mode
   *  (see scrubAlgae()). P5 §6 item 5. */
  algae = 0;
  /** Where each algae patch sits and what it looks like (see generateAlgaePatches's own doc comment
   *  for why this lives on the engine rather than being generated independently by each renderer) -
   *  regenerated only when the tank's size actually changes (see ensureAlgaePatches()), not every
   *  frame. How many of these are actually drawn at any moment scales with `algae` (see drawAlgae()) -
   *  this array itself doesn't change as algae grows/shrinks, only how much of it renderers reveal. */
  algaePatches: AlgaePatch[] = [];
  private algaePatchesSizeKey = '';

  /** The cat currently trying to steal a fish (P5 §6 item 7), or null - rolled once at init(), then
   *  either scared off (scarePredator()) or, once `expiresAt` passes unhandled, resolves into a stolen
   *  fish (see update()). Never persisted - see PredatorEvent's own doc comment in types.ts. */
  predator: PredatorEvent | null = null;

  /** When the next cat gets hungry enough to try the tank (epoch ms), or 0 before init() has set
   *  it. Transient like `predator` itself: closing the app resets the clock rather than banking
   *  hunger while nobody is watching. */
  private nextRaidAt = 0;

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
  /** Which 'background'-type sprite Life mode paints as the room behind the tank - the wall, window
   *  and table the glass stands on - or null for roomScene.ts's built-in gradient. Separate from
   *  backgroundSpriteId because the two are different pictures shown at the same time: that one goes
   *  inside the water, this one goes around the tank. */
  roomBackgroundSpriteId: string | null = null;
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

  /** Saving the tank as a picture, a GIF or a video (src/tank/export/sceneExport.ts). It is handed
   *  one callback - the scene at time t - and knows nothing else about the tank. */
  private readonly sceneExport = new SceneExport(
    (timeMs) => this.compositeScene(timeMs),
    () => this.tankName,
    () => this.reactNotify()
  );

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
  private roomDragOffset = { x: 0, y: 0 };
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
  /** False until hydrate() has finished - see its doc comment. */
  ready = false;
  /** Which tank this engine is showing. Null only before hydrate() has resolved it. There is exactly
   *  one tank today, but every read and write names it, so opening a second one later (plan P4-4) is a
   *  UI change rather than a storage one. */
  tankId: string | null = null;
  /** True when this engine is showing somebody else's tank. The two paths that reach outside the
   *  engine's own memory - save(), and re-reading the local sprite library in refreshPalette() -
   *  check it, so a read-only view cannot become a write no matter which button a future panel wires
   *  up. Everything else the engine does (fish swimming, dragging, dirty-marking) only ever moves
   *  numbers around in memory and is discarded with the page. */
  readonly readOnly: boolean;
  private readonly source: TankSource;
  private reactNotify: () => void = () => {};

  constructor(options: TankEngineOptions = {}) {
    this.source = options.source ?? localTankSource();
    this.readOnly = options.readOnly ?? false;
  }

  init(notify: () => void): void {
    this.reactNotify = notify;
    this.rafId = requestAnimationFrame((t) => this.loop(t));
    document.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('beforeunload', this.onBeforeUnload);
  }

  /**
   * Loads the tank from storage. Split out of init() because storage is asynchronous now (see
   * src/lib/data/adapter.ts): the engine starts with an empty tank and its animation loop already
   * running - harmless, there is nothing in it to draw - and fills in a moment later. `ready` says
   * which of the two states it is in so the UI does not present an empty tank as the user's own.
   */
  async hydrate(): Promise<void> {
    try {
      await this.loadEverything();
    } catch (err) {
      // See PixelEditorEngine.hydrate: unreadable storage means an empty tank the user can still play
      // with, never a permanent loading screen.
      console.error('loading the tank failed', err);
    }
    this.ready = true;
    this.resizeCanvas();
    this.reactNotify();
    // Not awaited: the tank is already on screen, and the switcher can fill in a moment later.
    void this.reloadTankList();
  }

  /**
   * Copies a loaded `TankState` into the engine's own fields - **every** persisted field, which is the
   * whole reason this is one method. Opening a tank at startup and switching to a different one are two
   * different code paths that both have to land the same tank in the same engine, and when this was
   * written out longhand in both, `refresh()`'s copy was missing `waterLevel`/`algae`/`lastTickAt`: a
   * tank switched to showed the *previous* tank's water level and algae, and since `snapshotForStorage`
   * reads these same fields straight back out, the next save wrote them onto the tank switched to. A
   * brand new tank inherited the old one's algae. Anything added to `TankState` has to be added here,
   * and only here.
   *
   * Deliberately does not touch selection/undo/dirty or the sprite library - those are the caller's,
   * and they differ between the two paths (see `refresh`).
   */
  private applyTankState(tankId: string, state: TankState): void {
    this.tankId = tankId;
    this.instances = state.instances.map((inst) => ({
      ...inst,
      groupId: inst.groupId ?? null,
      zone: inst.zone ?? null,
      visible: inst.visible ?? true,
    }));
    this.groups = state.groups.map((g) => ({ ...g, zone: g.zone ?? null }));
    this.tankWidth = state.width ?? TANK_SIZE_DEFAULT.width;
    this.tankHeight = state.height ?? TANK_SIZE_DEFAULT.height;
    this.roomInstances = state.roomInstances;
    this.tankShape = state.shape;
    this.tankCornerRadiusFrac = state.cornerRadiusFrac;
    this.tankOvalTopCutFrac = state.ovalTopCutFrac;
    this.backgroundSpriteId = state.backgroundSpriteId;
    this.roomBackgroundSpriteId = state.roomBackgroundSpriteId;
    this.backgroundTransform = state.backgroundTransform;
    this.waterLevel = state.waterLevel;
    this.algae = state.algae;
  }

  /**
   * Hunger/starvation, water-evaporation, and algae-growth catch-up (P5 §6 items 2/4/5,
   * docs/PIXI_MIGRATION_PLAN.md) - replays however much real time passed since `lastTickAt` as one
   * lump sum, so a tank left alone while the tab was closed is exactly as hungry/evaporated/algae-
   * covered on reopen as it would be had the app somehow kept simulating in the background the whole
   * time. A tank with no saved checkpoint yet has nothing to catch up on - elapsed is 0, not "since
   * the epoch". Algae's catch-up only ever uses its base growth rate, not the waste-accelerated one
   * (see tickAlgae()'s own doc comment) - waste itself isn't persisted, so there's no historical waste
   * count to have accelerated it while closed.
   *
   * Runs for a tank switched to as much as for the one open at startup: the elapsed time is read from
   * *that tank's* own last save, so switching to a tank untouched for three days replays those three
   * days, exactly as opening the app on it would.
   */
  private catchUpSince(lastTickAt: number | null): number {
    const now = Date.now();
    const elapsed = lastTickAt ? Math.max(0, now - lastTickAt) : 0;
    this.tickHunger(elapsed);
    this.tickWaterLevel(elapsed);
    this.tickAlgae(elapsed, 0);
    this.lastTickAt = now;
    return now;
  }

  private async loadEverything(): Promise<void> {
    const { tankId, sprites, state } = await this.source.load();
    this.sprites = sprites;
    this.applyTankState(tankId, state);
    const now = this.catchUpSince(state.lastTickAt);

    // Predator (P5 §6 item 7) - the first cat gets hungry some time in the next minute. Scheduled
    // here rather than in the shared helpers above because `refresh` (a tab switch, a remote sync)
    // deliberately must not restart the clock.
    this.nextRaidAt = now + randomBetween(PREDATOR_FIRST_HUNGER_MS);
  }

  destroy(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    // A video recording in progress was previously left running here: its redraw interval kept firing
    // against a canvas nothing was showing any more, and since nothing called stop() the recorder's
    // onstop never fired either - so the leak did not even buy a downloaded file.
    this.sceneExport.destroy();
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
    return spriteDims(sprite);
  }

  spritePx(sprite?: Sprite): { pw: number; ph: number } {
    const { width, height } = this.spriteDims(sprite);
    return { pw: width * DISPLAY_SCALE, ph: height * DISPLAY_SCALE };
  }

  spriteFor(inst: { spriteId: string }): Sprite | undefined {
    return this.sprites.find((s) => s.id === inst.spriteId);
  }

  /** Where the water's surface currently sits (P5 §6 item 4) - 0 (the very top) at waterLevel 1,
   *  moving down toward the tank floor as it evaporates. Nothing (fish, food-seeking, spawn position)
   *  is ever allowed above this, the same way nothing is allowed below the sand strip. */
  private waterTopY(): number {
    if (!this.canvas) return 0;
    return (1 - this.waterLevel) * this.canvas.height;
  }

  private maxSwimY(ph: number): number {
    if (!this.canvas) return 0;
    const h = this.canvas.height;
    const sandH = Math.max(18, h * 0.08);
    return Math.max(this.waterTopY(), h - sandH - ph);
  }

  private randomTargetY(ph: number): number {
    const top = this.waterTopY();
    const bottom = this.maxSwimY(ph);
    return top + Math.random() * Math.max(0, bottom - top);
  }

  private zoneFor(inst: Instance): SelectionBox | null {
    if (inst.groupId) return this.groups.find((g) => g.id === inst.groupId)?.zone ?? null;
    return inst.zone;
  }

  /** Min/max allowed values for inst.x/inst.y (top-left anchored), folding in the zone (if any), the
   *  water's current surface (P5 §6 item 4) and sand strip at top/bottom, and the canvas edges - so a
   *  zone that's gone stale (canvas resized, zone now partly off-screen) never traps a fish outside
   *  the reachable area. */
  private swimBoundsFor(inst: Instance): { xMin: number; xMax: number; yMin: number; yMax: number } {
    const { pw, ph } = this.spritePx(this.spriteFor(inst));
    const w = this.canvas!.width;
    const h = this.canvas!.height;
    const sandH = Math.max(18, h * 0.08);
    const xMaxFull = Math.max(0, w - pw);
    const yMinFull = this.waterTopY();
    const yMaxFull = Math.max(yMinFull, h - sandH - ph);
    const zone = this.zoneFor(inst);
    if (!zone) return { xMin: 0, xMax: xMaxFull, yMin: yMinFull, yMax: yMaxFull };
    const xMin = Math.min(Math.max(0, zone.x0), xMaxFull);
    const xMax = Math.min(xMaxFull, Math.max(xMin, zone.x1 - pw));
    const yMin = Math.min(Math.max(yMinFull, zone.y0), yMaxFull);
    const yMax = Math.min(yMaxFull, Math.max(yMin, zone.y1 - ph));
    return { xMin, xMax, yMin, yMax };
  }

  private randomTargetYInBounds(yMin: number, yMax: number): number {
    return yMin + Math.random() * Math.max(0, yMax - yMin);
  }

  /** Thin instance-bound wrapper around geometry.ts's pure clampTopLeftToShape (see
   *  docs/PIXI_MIGRATION_PLAN.md P3) - every call site below already works in terms of `this`, so
   *  this just forwards the engine's own tankShape/tankCornerRadiusFrac/tankOvalTopCutFrac fields as
   *  explicit arguments rather than the pure function reading them off `this` directly (which would
   *  make it not-actually-pure and defeat the point of having pulled it out). */
  private clampTopLeftToShape(x: number, y: number, pw: number, ph: number, w: number, h: number): { x: number; y: number; moved: boolean } {
    return clampTopLeftToShapePure(this.tankShape, this.tankCornerRadiusFrac, this.tankOvalTopCutFrac, x, y, pw, ph, w, h);
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
    if (!this.canvas) return;
    const rect = this.wrap?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) {
      // No live layout to measure yet - happens when Life mode is opened (or reloaded into directly)
      // before Build mode's own DOM has ever actually been visible, since that's a `hidden` (display:
      // none, no layout at all) sibling under the same TankSection - see docs/PIXI_MIGRATION_PLAN.md
      // P5 for how this was found (Life mode's Pixi scene reads engine.canvas.width/height, which
      // would otherwise stay unset forever in that case). Falls back to the logical tank size
      // directly so the simulation has a real, correct size the moment it exists, rather than only
      // once Build mode happens to be shown - which still fully overrides this with the real,
      // zoom-aware DOM measurement the instant it *is* shown (see the ResizeObserver below).
      if (!this.hasSized && this.canvas) {
        this.canvas.width = this.tankWidth ?? TANK_SIZE_DEFAULT.width;
        this.canvas.height = this.tankHeight ?? TANK_SIZE_DEFAULT.height;
        this.hasSized = true;
      }
      return;
    }
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

  /** Re-reads the sprite library after the editor changed it. Reads the repository's in-memory cache,
   *  not storage: this runs from a DOM event handler and from the render path's neighbourhood, neither
   *  of which can await anything (see SpriteRepo's doc comment). */
  refreshPalette(): void {
    // A shared tank brought its own sprites with it and the local library is not its library - reading
    // it here would swap another user's fish for whatever this browser happens to have under the same
    // ids, or for nothing at all.
    if (this.readOnly) return;
    this.sprites = getRepos().sprites.list();
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
      ...storage.newRecordMeta(),
      id: storage.uid('sprite'),
      name: file.name.replace(/\.[^./\\]+$/, '') || t('sprite.defaultBackgroundName'),
      type: 'background',
      width,
      height,
      frames: [[storage.makeLayer(frame)]],
      frameMs: storage.DEFAULT_FRAME_MS,
    };
    const repo = getRepos().sprites;
    await repo.put(sprite);
    this.sprites = repo.list();
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

  /** Picks the room backdrop Life mode paints behind the tank, or null for the built-in gradient.
   *  Unlike setTankBackgroundSprite there is no transform to reset: the room art is always stretched
   *  to cover the whole viewport (see roomScene.ts's fitRoomBackground), so there is nothing for the
   *  user to place by hand and nothing to lose by re-picking the same one. */
  setRoomBackgroundSprite(id: string | null): void {
    if (this.roomBackgroundSpriteId === id) return;
    this.roomBackgroundSpriteId = id;
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
    if (this.roomBackgroundSpriteId === spriteId) {
      this.roomBackgroundSpriteId = null;
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

  /**
   * Writes the tank through the storage layer (src/lib/data). Returns whether it worked
   * so the caller can tell the user - a save that fails silently is worse than no save button at all,
   * since the user walks away believing the tank is stored (docs/STORAGE_DB_MIGRATION_PLAN.md P0-3).
   * `dirty` deliberately stays true on failure: the unsaved work is still in memory and still at risk.
   */
  /** The tank as the storage layer wants it (see TankState) - one place that knows the mapping, so
   *  save() reads as "write the tank" rather than as a list of twelve individual writes. */
  private snapshotForStorage(): TankState {
    return {
      instances: this.instances,
      groups: this.groups,
      roomInstances: this.roomInstances,
      width: this.tankWidth,
      height: this.tankHeight,
      shape: this.tankShape,
      cornerRadiusFrac: this.tankCornerRadiusFrac,
      ovalTopCutFrac: this.tankOvalTopCutFrac,
      backgroundSpriteId: this.backgroundSpriteId,
      roomBackgroundSpriteId: this.roomBackgroundSpriteId,
      backgroundTransform: this.backgroundTransform,
      waterLevel: this.waterLevel,
      algae: this.algae,
      lastTickAt: this.lastTickAt,
    };
  }

  async save(): Promise<{ ok: boolean; error?: unknown }> {
    if (this.readOnly) return { ok: false, error: new Error('this tank belongs to someone else') };
    let result: { ok: boolean; error?: unknown } = { ok: true };
    // The tank is saved as one batch, so every record in it is stamped with the same moment rather
    // than tracking which individual fish actually moved: pretending to per-record precision the save
    // model does not have would be worse than none when these timestamps start deciding merges
    // (RecordMeta in types.ts). Per-record stamping arrives with per-record writes - plan P4/P5.
    this.instances = this.instances.map(storage.touchMeta);
    this.groups = this.groups.map(storage.touchMeta);
    this.roomInstances = this.roomInstances.map(storage.touchMeta);
    try {
      await getRepos().tank.save(this.snapshotForStorage(), this.tankId ?? undefined);
      this.dirty = false;
    } catch (err) {
      console.warn('tank save failed', err);
      result = { ok: false, error: err };
    }
    // Committing the placement, Photoshop-free-transform-style - see backgroundHandlesVisible.
    this.backgroundHandlesVisible = false;
    this.reactNotify();
    return result;
  }

  /** Reloads instances/groups/tank size from localStorage, discarding any unsaved in-memory edits
   *  (including an unsaved resize) - prompts first if there's actually something to lose (mirrors
   *  the sprite editor's newSprite()). */
  /** Every tank this browser holds, for the switcher. Empty until reloadTankList() has run, and empty
   *  forever on a backend that only supports one (see StorageAdapter.supportsMultipleTanks). */
  tanks: TankSummary[] = [];

  get tankName(): string {
    return this.tanks.find((t) => t.id === this.tankId)?.name ?? '';
  }

  get supportsMultipleTanks(): boolean {
    return !this.readOnly && getRepos().tank.supportsMultiple;
  }

  async reloadTankList(): Promise<void> {
    if (this.readOnly) return;
    this.tanks = await getRepos().tank.list();
    this.reactNotify();
  }

  /**
   * Opens another tank.
   *
   * Unsaved work is the whole difficulty here: the tank is manual-save, so switching away from one
   * with pending edits would throw them out. The confirmation is the same one Refresh asks, for the
   * same reason, and a refusal leaves everything exactly as it was - including which tank is current,
   * which is why the id is only written after the prompt is past.
   */
  async switchTank(id: string, confirmDiscard: () => boolean): Promise<boolean> {
    if (this.readOnly || id === this.tankId) return false;
    if (this.dirty && !confirmDiscard()) return false;
    await getRepos().tank.setCurrentId(id);
    await this.refresh(() => true);
    await this.reloadTankList();
    return true;
  }

  /** Creates a tank and opens it. Same discard prompt as switching, asked before anything is created:
   *  a user who backs out should not be left with an empty tank they never wanted. */
  async createTank(name: string, confirmDiscard: () => boolean): Promise<boolean> {
    if (this.readOnly) return false;
    if (this.dirty && !confirmDiscard()) return false;
    const id = await getRepos().tank.create(name);
    await getRepos().tank.setCurrentId(id);
    await this.refresh(() => true);
    await this.reloadTankList();
    return true;
  }

  async renameTank(id: string, name: string): Promise<void> {
    if (this.readOnly) return;
    await getRepos().tank.rename(id, name);
    await this.reloadTankList();
  }

  /**
   * Deletes a tank, and everything in it, on this device and on the others.
   *
   * The storage layer refuses the last one. Deleting the tank currently open is allowed - it moves to
   * another one - because the alternative is telling someone they must first switch away from the
   * thing they are trying to get rid of.
   */
  async deleteTank(id: string, confirmDelete: () => boolean): Promise<{ ok: boolean; error?: unknown }> {
    if (this.readOnly) return { ok: false };
    if (this.tanks.length <= 1) return { ok: false, error: new Error('cannot delete the only tank') };
    if (!confirmDelete()) return { ok: false };
    try {
      const wasCurrent = id === this.tankId;
      await getRepos().tank.delete(id);
      await this.reloadTankList();
      if (wasCurrent) {
        // Whatever the storage layer moved to; the deleted tank's unsaved edits go with it, which is
        // what deleting it meant.
        this.dirty = false;
        await this.refresh(() => true);
      }
      return { ok: true };
    } catch (err) {
      console.warn('deleting the tank failed', err);
      return { ok: false, error: err };
    }
  }

  async refresh(confirmDiscard: () => boolean): Promise<void> {
    if (this.dirty && !confirmDiscard()) return;
    // The id comes back too: reloading is also how switching tanks lands, and the engine has to end up
    // pointing at whichever tank it just loaded rather than the one it was showing before.
    const { tankId, state } = await this.source.load();
    this.applyTankState(tankId, state);
    this.catchUpSince(state.lastTickAt);
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
    const now = Date.now();
    const inst: Instance = {
      ...storage.newRecordMeta(),
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
      bornAt: now,
      lifespanMs: sprite.type === 'fish' ? storage.randomFishLifespanMs() : 0,
      dead: false,
      diedAt: 0,
      hunger: 1,
      starvingSince: 0,
      // Placed directly by the user, not bred - already fully grown (see growthScale()).
      matureAt: now,
      wellFedSince: 0,
    };
    this.instances.push(inst);
    this.persist();
  }

  /** Keeps a room decoration's center within ROOM_MARGIN_FRAC of the tank's own size beyond its
   *  edges - same coordinate space and scale as Instance.x/y (see RoomInstance's doc comment in
   *  types.ts), just not clamped to the tank rectangle itself since room decor lives *around* the
   *  swim area, not in it. Replaces the old viewport-fraction clamp (clampRoomFrac) entirely - being
   *  in the tank's own space means this margin scales with the tank's own size automatically, the
   *  same "one picture, one scale" property everything else in the P2 migration gets for free. */
  private clampRoomPosition(x: number, y: number): { x: number; y: number } {
    const w = this.tankWidth ?? 0;
    const h = this.tankHeight ?? 0;
    const { marginX, marginY } = storage.roomSceneMargin(w, h);
    return {
      x: Math.min(w + marginX, Math.max(-marginX, x)),
      y: Math.min(h + marginY, Math.max(-marginY, y)),
    };
  }

  // --- export ---

  /** A room decoration's footprint in the same logical units as the tank canvas's own raster (1 unit
   *  = 1 pixel of `this.canvas`, i.e. tank-logical px) - the coordinate space compositeScene draws
   *  everything into. Trivial now that RoomInstance.x/y already live in that same space (see its own
   *  doc comment in types.ts) - no zoom/viewport reprojection needed at all, unlike the pre-P2
   *  version this replaces. */
  private roomRect(inst: RoomInstance): SelectionBox | null {
    const sprite = this.spriteFor(inst);
    if (!sprite) return null;
    const { pw, ph } = this.spritePx(sprite);
    return { x0: inst.x - pw / 2, y0: inst.y - ph / 2, x1: inst.x + pw / 2, y1: inst.y + ph / 2 };
  }

  /**
   * Composites the tank frame's own live raster (fish, decorations, water, glass outline - whatever
   * `this.canvas` currently shows, kept animating by the loop below regardless of export) together
   * with every visible room decoration into one flat image - the shared basis for every export format
   * (PNG grabs one, GIF and video sample it repeatedly). Room decor positions come straight from
   * `roomRect()`, which - since RoomInstance.x/y already live in the same tank-logical space as
   * `this.canvas`'s own raster (see its doc comment in types.ts) - needs no zoom/viewport reprojection
   * at all: an export is inherently "at 100%, tank-logical scale" simply by using those coordinates
   * directly, full pixel-art crisp regardless of what zoom the editor happened to be showing.
   *
   * `timeMs` drives each room item's own frame animation (they don't share the tank canvas's own loop -
   * see tankScene.ts) deterministically from a single clock, so a GIF/video's sampled frames animate
   * room decor in lockstep with however many times compositeScene has been called, rather than each
   * one free-running on its own real-time timer the way the live on-screen view does.
   */
  private compositeScene(timeMs = 0): HTMLCanvasElement {
    const out = document.createElement('canvas');
    if (!this.canvas || !this.tankWidth || !this.tankHeight) return out;

    const rects = this.roomInstances
      .filter((r) => r.visible ?? true)
      .map((inst) => ({ inst, rect: this.roomRect(inst) }))
      .filter((r): r is { inst: RoomInstance; rect: SelectionBox } => r.rect !== null);

    let x0 = 0, y0 = 0, x1 = this.tankWidth, y1 = this.tankHeight;
    rects.forEach(({ rect }) => {
      x0 = Math.min(x0, rect.x0);
      y0 = Math.min(y0, rect.y0);
      x1 = Math.max(x1, rect.x1);
      y1 = Math.max(y1, rect.y1);
    });
    out.width = Math.max(1, Math.round(x1 - x0));
    out.height = Math.max(1, Math.round(y1 - y0));
    const ctx = out.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;

    // A room item sitting off to one side of the frame (rather than centered on it) makes this
    // canvas's own bounding box bigger than the frame alone - the slack space around the frame and
    // outside every room item's own footprint would otherwise stay fully transparent. That reads fine
    // as a PNG, but a GIF's palette has no real alpha channel (only a single all-or-nothing
    // transparent index - see exportGif), so an unfilled background there would come out as an ugly
    // solid block of whatever color quantize() happens to pick for "transparent". Filling with the
    // tank viewport's own background color instead means every export format gets the same, sensible
    // backdrop - this reads as "a photo of the tank on the shelf it's sitting on," not a cutout.
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--pixel-bg-deep').trim() || '#2b2b2b';
    ctx.fillRect(0, 0, out.width, out.height);

    ctx.drawImage(this.canvas, -x0, -y0);

    rects.forEach(({ inst, rect }) => {
      const sprite = this.spriteFor(inst)!;
      const { width, height } = this.spriteDims(sprite);
      const frameIndex = sprite.frames.length > 1 ? Math.floor(timeMs / (sprite.frameMs || 400)) % sprite.frames.length : 0;
      ctx.save();
      ctx.translate(rect.x0 - x0, rect.y0 - y0);
      paintLayers(ctx, sprite.frames[frameIndex], width, height, DISPLAY_SCALE);
      ctx.restore();
    });

    return out;
  }

  // The three export formats (still PNG, animated GIF, WebM recording) live in
  // src/tank/export/sceneExport.ts. They only ever ask for "the scene at time t", which is what
  // compositeScene above provides - nothing about saving a file needs to know what is in the tank.

  exportPng(): void {
    this.sceneExport.png();
  }

  exportGif(durationMs?: number): Promise<void> {
    return this.sceneExport.gif(durationMs);
  }

  startVideoExport(): void {
    this.sceneExport.startVideo();
  }

  stopVideoExport(): void {
    this.sceneExport.stopVideo();
  }

  get isRecordingVideo(): boolean {
    return this.sceneExport.isRecording;
  }

  get exportingGif(): boolean {
    return this.sceneExport.encodingGif;
  }

  /** Drops a new room decoration at the given screen point, converted through the same canvasPoint()
   *  every other pointer handler uses (tank-logical px, not clamped to the tank rectangle itself - see
   *  clampRoomPosition) - counterpart to addInstance() for kind 'room' sprites, sharing its coordinate
   *  space now instead of a separate viewport-fraction one (see RoomInstance's doc comment in
   *  types.ts). */
  addRoomInstance(spriteId: string, clientX: number, clientY: number): void {
    const sprite = this.sprites.find((s) => s.id === spriteId);
    if (!sprite) return;
    const p = this.canvasPoint(clientX, clientY);
    if (!p) return;
    const { x, y } = this.clampRoomPosition(p.x, p.y);
    const inst: RoomInstance = { ...storage.newRecordMeta(), id: storage.uid('room'), spriteId, x, y, visible: true };
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

  /** Grabs a room decoration to start dragging it. Takes raw screen coordinates rather than a DOM
   *  PointerEvent (unlike this class's own on-canvas pointer handlers) so it can be driven by either
   *  renderer's own event system - the DOM one RoomLayer.tsx used before P2, or a Pixi sprite's
   *  FederatedPointerEvent (see tankScene.ts) - without this method needing to know or care which.
   *  Event-specific bits (stopPropagation, setPointerCapture) are the caller's responsibility. */
  onRoomPointerDown(clientX: number, clientY: number, id: string): void {
    const inst = this.roomInstances.find((r) => r.id === id);
    if (!inst) return;
    const p = this.canvasPoint(clientX, clientY);
    if (!p) return;
    this.roomDragOffset = { x: p.x - inst.x, y: p.y - inst.y };
    this.draggingRoomId = id;
    this.roomDragMoved = false;
    this.roomDragUndoSnapshot = this.snapshotState();
    this.selectRoomInstance(id);
  }

  onRoomPointerMove(clientX: number, clientY: number): void {
    if (!this.draggingRoomId) return;
    const inst = this.roomInstances.find((r) => r.id === this.draggingRoomId);
    if (!inst) return;
    const p = this.canvasPoint(clientX, clientY);
    if (!p) return;
    const rawX = p.x - this.roomDragOffset.x;
    const rawY = p.y - this.roomDragOffset.y;
    const { x, y } = this.clampRoomPosition(rawX, rawY);
    if (Math.abs(x - inst.x) > 0.5 || Math.abs(y - inst.y) > 0.5) this.roomDragMoved = true;
    inst.x = x;
    inst.y = y;
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
    const group: TankGroup = { ...storage.newRecordMeta(), id: storage.uid('group'), name: `Group ${this.groups.length + 1}`, zone: null };
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
    // A dead fish (P5 §6 item 1) is collected by clicking it, not selected/dragged - see the `dead`
    // doc comment in types.ts.
    if (inst.dead) {
      this.removeInstance(inst.id);
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

  /** Drops a food pellet at (x, y) in tank-logical coordinates (P5 §6 item 2) - called from the Life
   *  mode feed interaction. Purely appends to `foodItems`; falling and being eaten both happen in
   *  update() every frame same as everything else in the tank. */
  feedAt(x: number, y: number): void {
    if (!this.canvas) return;
    this.foodItems.push({
      id: storage.uid('food'),
      x: Math.max(0, Math.min(this.canvas.width, x)),
      y: Math.max(0, y),
      vy: FOOD_FALL_SPEED,
    });
    // A deliberate user action (unlike the food actually falling/being eaten afterward, which is just
    // simulation), so it should count as "the tank changed" the same way dragging a fish does - see
    // the persist() doc comment. Load-bearing in practice: Life mode has no Save button of its own, so
    // without this the only way any Life-mode action ever became saveable was an unrelated edit
    // happening to also occur in Build Tank first.
    this.persist();
  }

  /** Tops the tank back off (P5 §6 item 4) - called from the Life-mode refill button. Instant, like
   *  feedAt() dropping a pellet the moment it's tapped - real refilling isn't a slow simulated process
   *  worth animating out here. */
  refillWater(): void {
    this.waterLevel = 1;
    this.persist();
  }

  // The three slow clocks (hunger/starvation, evaporation, algae growth) are pure functions in
  // src/tank/sim/vitals.ts. They take an elapsed duration rather than reading a clock, which is what
  // lets one frame and one app-closed gap go through exactly the same code.

  private tickWaterLevel(elapsedMs: number): void {
    this.waterLevel = decayWaterLevel(this.waterLevel, elapsedMs);
  }

  private tickAlgae(elapsedMs: number, wasteCount: number): void {
    this.algae = growAlgae(this.algae, elapsedMs, wasteCount);
  }

  private tickHunger(elapsedMs: number): void {
    decayHunger(this.instances, elapsedMs, Date.now());
  }

  /** Wipes some algae off the glass (P5 §6 item 5) - called from the Life-mode scrub-drag with however
   *  far the pointer moved since the last call, so a longer/faster drag cleans more, matching how
   *  actually scrubbing something works rather than a fixed amount per click. */
  scrubAlgae(dragDistancePx: number): void {
    if (dragDistancePx <= 0) return;
    this.algae = Math.max(0, this.algae - dragDistancePx / ALGAE_SCRUB_PX_TO_CLEAN);
    // Same reasoning as feedAt()'s persist() call - a user action, and the only way it ever becomes
    // saveable given Life mode has no Save button of its own. Called once per drag-move event (like
    // dragging a fish already does), not just once per whole gesture.
    this.persist();
  }

  /** Scares the current predator off (P5 §6 item 7) - called from Life mode tapping directly on it.
   *  No-op if there isn't one right now (e.g. it already resolved this same frame).
   *
   *  A tap lands only while the cat is still on its way in, watching, or mid-pounce. Once it has
   *  the fish there is nothing left to scare it away from, and letting a late tap end the feast
   *  early would read as the tap having worked when the fish is already gone. */
  scarePredator(): void {
    const predator = this.predator;
    if (!predator || predator.phase === 'flee' || predator.phase === 'feast') return;
    // It turns and runs the way it was heading from, not the way it was facing at the tank.
    predator.facingLeft = predator.targetXFrac <= 0.5;
    this.enterPredatorPhase('flee', Date.now());
  }

  /** Removes a random live fish permanently (P5 §6 item 7, §9 Q6 - "หายจากตู้ถาวร") - deliberately not
   *  the same path as old-age/starvation death (no float-to-surface, no grayscale, nothing left to
   *  collect): a fish a predator actually got away with is just gone, the way it would be in real life. */
  private stealRandomFish(): void {
    const liveFish = this.instances.filter((i) => i.kind === 'fish' && !i.dead);
    if (!liveFish.length) return;
    const victim = liveFish[Math.floor(Math.random() * liveFish.length)];
    this.instances = this.instances.filter((i) => i.id !== victim.id);
    this.persist();
  }

  /** Regenerates algaePatches only when the tank's own size has actually changed - the layout itself
   *  doesn't need to change as `algae` grows/shrinks, only how much of it drawAlgae()/tankScene.ts
   *  reveal (see algaePatches's own doc comment). */
  private ensureAlgaePatches(): void {
    if (!this.canvas) return;
    const key = `${this.canvas.width}:${this.canvas.height}`;
    if (key === this.algaePatchesSizeKey) return;
    this.algaePatchesSizeKey = key;
    this.algaePatches = generateAlgaePatches(this.canvas.width, this.canvas.height);
  }

  /** BABY_SCALE_FRAC (newborn) .. 1 (fully grown), interpolated linearly between bornAt and matureAt - a purely
   *  *visual* scale (see the callers in drawInstance()/tankScene.ts, which shrink only the drawn
   *  sprite size). A newborn's swim-bounds footprint, hit-testing, and collision all stay full adult
   *  size throughout growth - a deliberate simplification: touching every spritePx() consumer
   *  (swimBoundsFor, clampTopLeftToShape, food-seeking, etc.) to also track a shrinking footprint
   *  would be real additional surface area for a purely cosmetic detail, at the cost of a young fish's
   *  hit box being a bit bigger than it visually looks - an acceptable trade for how rarely that
   *  actually matters in play. */
  private growthScale(inst: Instance): number {
    if (inst.matureAt <= inst.bornAt) return 1;
    const frac = (Date.now() - inst.bornAt) / (inst.matureAt - inst.bornAt);
    const clamped = Math.max(0, Math.min(1, frac));
    return BABY_SCALE_FRAC + (1 - BABY_SCALE_FRAC) * clamped;
  }

  /** One randomly-timed birth check per frame (P5 §6 item 6) - eligibility (≥2 fish that have each
   *  been well-fed continuously for WELL_FED_MIN_MS, per §9 Q4) gates whether a birth can happen at
   *  all; the tank's current total fish count then scales *how likely* one is this tick, tapering off
   *  entirely at BREEDING_POPULATION_CAP. Evaluated as a per-ms rate over `elapsedMs` rather than
   *  waiting for some fixed "once a day" moment, so the odds work out the same whether checked every
   *  frame or (like everything else in this file) resolved as one lump sum after the app was closed
   *  for a while - see the `elapsedMs` shape shared with tickHunger/tickWaterLevel/tickAlgae. Skipped
   *  entirely during that closed-app catch-up though (see the `0` passed at its init() call site) -
   *  unlike the others, missing a chance to breed while closed has no real correctness stakes the way
   *  starvation timing does, so it's simplest to just start counting from the moment the app reopens. */
  private tickBreeding(elapsedMs: number): void {
    if (elapsedMs <= 0 || !this.canvas) return;
    const now = Date.now();
    const liveFish = this.instances.filter((i) => i.kind === 'fish' && !i.dead);
    if (liveFish.length < 2) return;
    const eligible = liveFish.filter(
      (i) => i.matureAt <= now && i.wellFedSince !== 0 && now - i.wellFedSince >= WELL_FED_MIN_MS,
    );
    if (eligible.length < 2) return;
    const dailyChance = BREEDING_DAILY_CHANCE * Math.max(0, 1 - liveFish.length / BREEDING_POPULATION_CAP);
    if (dailyChance <= 0) return;
    const chancePerMs = dailyChance / DAY_MS;
    if (Math.random() < chancePerMs * elapsedMs) {
      const parent = eligible[Math.floor(Math.random() * eligible.length)];
      this.spawnBaby(parent);
    }
  }

  /** Creates a newborn fish (P5 §6 item 6) next to `parent`, sharing its sprite (per §9 Q4 - a baby
   *  looks like a small version of whichever fish had it, not some separate "baby" art) but otherwise
   *  a brand new Instance with its own rolled lifespan/hunger/etc., same as one placed by the user -
   *  the only things marking it as bred rather than placed are `matureAt` (see growthScale()) and
   *  starting right next to its parent instead of wherever the user last clicked. */
  private spawnBaby(parent: Instance): void {
    const sprite = this.spriteFor(parent);
    if (!sprite || !this.canvas) return;
    const { pw, ph } = this.spritePx(sprite);
    const swimSpeed: SwimSpeed = 'medium';
    const { vx, vy } = randomSwimVelocity(swimSpeed);
    const offsetX = parent.x + (Math.random() - 0.5) * 2 * BABY_SPAWN_OFFSET;
    const offsetY = parent.y + (Math.random() - 0.5) * 2 * BABY_SPAWN_OFFSET;
    const placed = this.clampTopLeftToShape(offsetX, offsetY, pw, ph, this.canvas.width, this.canvas.height);
    const now = Date.now();
    const baby: Instance = {
      ...storage.newRecordMeta(),
      id: storage.uid('inst'),
      spriteId: parent.spriteId,
      kind: 'fish',
      x: placed.x,
      y: placed.y,
      dir: Math.random() < 0.5 ? -1 : 1,
      vx,
      vy,
      targetY: this.randomTargetY(ph),
      frameIndex: 0,
      frameTimer: 0,
      bobPhase: Math.random() * Math.PI * 2,
      isDragging: false,
      swimSpeed,
      groupId: null,
      schoolOffsetY: (Math.random() - 0.5) * 40,
      zone: null,
      visible: true,
      bornAt: now,
      lifespanMs: storage.randomFishLifespanMs(),
      dead: false,
      diedAt: 0,
      hunger: 1,
      starvingSince: 0,
      matureAt: now + BABY_MATURATION_MS,
      wellFedSince: 0,
    };
    this.instances.push(baby);
    this.persist();
  }

  /** Nearest not-yet-eaten food item to (cx, cy), or null - no attraction-radius cutoff, a hungry fish
   *  always makes for whatever food exists rather than only what's "nearby" (a tank only ever has a
   *  handful of pellets at once, so this is cheap and there's no realism lost). */
  private nearestFood(cx: number, cy: number): FoodItem | null {
    let best: FoodItem | null = null;
    let bestDist = Infinity;
    for (const food of this.foodItems) {
      const dist = Math.hypot(food.x - cx, food.y - cy);
      if (dist < bestDist) {
        bestDist = dist;
        best = food;
      }
    }
    return best;
  }

  private eatFood(inst: Instance, foodId: string): void {
    this.foodItems = this.foodItems.filter((f) => f.id !== foodId);
    inst.hunger = Math.min(1, inst.hunger + FOOD_HUNGER_GAIN);
    inst.starvingSince = 0;
    // Digestion (P5 §6 item 3) - a real delay rather than pooping instantly on the same spot it just
    // ate, so waste shows up as its own later event instead of looking tied to the pellet. Overwrites
    // any still-pending poop from an earlier meal rather than stacking multiple - one fish only ever
    // has one poop "in flight" at a time.
    this.poopDueAt.set(inst.id, Date.now() + POOP_DELAY_MIN_MS + Math.random() * (POOP_DELAY_MAX_MS - POOP_DELAY_MIN_MS));
  }

  /** 1 (spotless) down to 0 - a live readout of how much uncollected waste is sitting in the tank right
   *  now, not a persisted/decaying meter like hunger. Purely `wasteItems.length` today; once water
   *  level and algae (P5 §6 items 4-5) exist, this is where they'll fold in too, per the single
   *  "tank cleanliness" status §9 Q3 asked for - the per-fish hunger bar and this are the two bars Q3
   *  described. */
  get tankCleanliness(): number {
    return Math.max(0, 1 - this.wasteItems.length / WASTE_MAX_FOR_ZERO_QUALITY);
  }

  /** Tries to collect whatever waste is nearest (x, y) (Life-mode tap - see roomScene.ts's tap/drag
   *  state machine) - returns whether one was actually close enough to collect, so the caller can fall
   *  through to a different action (dropping food) when the tap didn't land on any waste. */
  collectWasteAt(x: number, y: number): boolean {
    let nearest: WasteItem | null = null;
    let bestDist = Infinity;
    for (const w of this.wasteItems) {
      const dist = Math.hypot(w.x - x, w.y - y);
      if (dist < bestDist) {
        bestDist = dist;
        nearest = w;
      }
    }
    if (!nearest || bestDist > WASTE_COLLECT_RADIUS) return false;
    this.wasteItems = this.wasteItems.filter((w) => w.id !== nearest!.id);
    // Same reasoning as feedAt()'s persist() call - see its doc comment.
    this.persist();
    return true;
  }

  /**
   * One frame of tank life, in the order the phases have to happen: the slow clocks first (they can
   * kill a fish, which everything after has to see), then the things falling through the water, then
   * the schooling targets - which are read by, and so must be computed before, the per-instance
   * movement that closes the frame.
   */
  private update(dt: number): void {
    if (!this.canvas || !this.hasSized) return;
    const elapsedMs = dt * 1000;

    this.tickHunger(elapsedMs);
    this.tickWaterLevel(elapsedMs);
    this.tickAlgae(elapsedMs, this.wasteItems.length);
    this.ensureAlgaePatches();
    this.tickBreeding(elapsedMs);

    this.stepPredator(dt);
    this.stepFood(dt);
    this.stepPooping();
    this.stepWaste(dt);

    const schoolSteer = computeSchoolSteer(this.instances);
    this.instances.forEach((inst) => this.stepInstance(inst, dt, schoolSteer));
  }

  /** Advances the raid one frame: walk in, sit and stare, pounce, then either flee or eat.
   *  Only the pounce phase can cost the player a fish, and only by running out - every other phase
   *  ends on its own clock. `dt` is seconds, as everywhere else in the step methods. */
  private stepPredator(dt: number): void {
    const now = Date.now();
    if (!this.predator) {
      if (this.nextRaidAt && now >= this.nextRaidAt) this.beginRaid(now);
      return;
    }
    const predator = this.predator;
    const since = now - predator.phaseStartedAt;
    switch (predator.phase) {
      case 'approach': {
        const step = PREDATOR_WALK_FRAC_PER_S * dt;
        const remaining = predator.targetXFrac - predator.xFrac;
        if (Math.abs(remaining) <= step) {
          predator.xFrac = predator.targetXFrac;
          // Turn to face the tank before sitting down to watch it.
          predator.facingLeft = predator.targetXFrac > 0.5;
          this.enterPredatorPhase('stalk', now);
        } else {
          predator.xFrac += Math.sign(remaining) * step;
          predator.facingLeft = remaining < 0;
        }
        break;
      }
      case 'stalk':
        if (since >= PREDATOR_STALK_MS) {
          this.enterPredatorPhase('pounce', now);
          predator.expiresAt = now + PREDATOR_REACT_MS;
        }
        break;
      case 'pounce':
        if (now >= predator.expiresAt) {
          this.stealRandomFish();
          this.enterPredatorPhase('feast', now);
        }
        break;
      case 'flee': {
        // Straight out of the room the way it came, rather than back to its sleeping spot: the spot
        // is already drawn empty for the raider, and a cat that trots home would need a whole
        // settling-down animation to not look like it teleported into a nap.
        predator.xFrac += (predator.facingLeft ? -1 : 1) * PREDATOR_WALK_FRAC_PER_S * 2 * dt;
        if (since >= PREDATOR_FLEE_MS) this.endRaid(now);
        break;
      }
      case 'feast':
        if (since >= PREDATOR_FEAST_MS) this.endRaid(now);
        break;
    }
  }

  /** One cat wakes up hungry and starts across the room. Skipped if there is nothing in the tank
   *  worth taking - a cat that stalks an empty tank is just a cat walking into a wall - and in that
   *  case the clock is simply pushed back so it tries again later. */
  private beginRaid(now: number): void {
    if (!this.instances.some((i) => i.kind === 'fish' && !i.dead)) {
      this.nextRaidAt = now + randomBetween(PREDATOR_NEXT_HUNGER_MS);
      return;
    }
    // Which side of the tank it makes for, and therefore which edge of the room it walks in from -
    // the far one, so the approach is actually visible rather than a step and a half.
    const targetXFrac = PREDATOR_TANK_SIDES[Math.floor(Math.random() * PREDATOR_TANK_SIDES.length)];
    const fromLeft = targetXFrac >= 0.5;
    this.predator = {
      // Which of the room's cats gets up. Uniform across the coats: they are the same animal in
      // three colours, so there is no reason for one to raid more often than another.
      variant: CAT_VARIANTS[Math.floor(Math.random() * CAT_VARIANTS.length)],
      phase: 'approach',
      xFrac: fromLeft ? -0.05 : 1.05,
      targetXFrac,
      facingLeft: !fromLeft,
      phaseStartedAt: now,
      spawnedAt: now,
      // Set for real when the pounce phase starts; until then there is no deadline to run down.
      expiresAt: now + PREDATOR_REACT_MS,
    };
  }

  /** The visit is over, however it went, and the next one is scheduled from here. */
  private endRaid(now: number): void {
    this.predator = null;
    this.nextRaidAt = now + randomBetween(PREDATOR_NEXT_HUNGER_MS);
  }

  private enterPredatorPhase(phase: PredatorPhase, now: number): void {
    if (!this.predator) return;
    this.predator.phase = phase;
    this.predator.phaseStartedAt = now;
  }

  private stepFood(dt: number): void {
    if (!this.foodItems.length || !this.canvas) return;
    // Rests just above the sand strip fish can't swim into (see swimBoundsFor's own sandH) rather
    // than at the tank's literal bottom edge - a pellet that sinks past where any fish can ever
    // reach it (in the center-of-sprite sense the food-seeking below targets) would sit there
    // uneaten forever, permanently stuck a few pixels out of reach.
    const sandH = Math.max(18, this.canvas.height * 0.08);
    const floorY = this.canvas.height - sandH - 16;
    this.foodItems.forEach((food) => {
      food.y = Math.min(floorY, food.y + food.vy * dt);
    });
  }

  /** Turns the pellets eaten a while ago into waste, now that enough time has passed. */
  private stepPooping(): void {
    if (!this.poopDueAt.size) return;
    const now = Date.now();
    this.poopDueAt.forEach((dueAt, id) => {
      if (now < dueAt) return;
      this.poopDueAt.delete(id);
      const inst = this.instances.find((i) => i.id === id);
      // A fish that died or was removed between eating and pooping just quietly never poops - there's
      // no fish left for the waste to have come from.
      if (!inst || inst.dead) return;
      const { pw, ph } = this.spritePx(this.spriteFor(inst));
      this.wasteItems.push({ id: storage.uid('waste'), x: inst.x + pw / 2, y: inst.y + ph / 2, createdAt: now });
    });
  }

  private stepWaste(dt: number): void {
    if (!this.wasteItems.length || !this.canvas) return;
    // Unlike food, nothing needs to reach waste, so it just settles at the tank's own floor rather
    // than the fish-reachable band food is kept within.
    const floorY = this.canvas.height - 10;
    this.wasteItems.forEach((w) => {
      w.y = Math.min(floorY, w.y + WASTE_FALL_SPEED * dt);
    });
  }

  /** One instance's frame: aging and death, then animation, then - for a live fish that isn't being
   *  dragged - swimming. */
  private stepInstance(inst: Instance, dt: number, schoolSteer: Map<string, SchoolSteer>): void {
    const sprite = this.spriteFor(inst);
    if (!sprite) return;

    // Old-age death (P5 §6 item 1, docs/PIXI_MIGRATION_PLAN.md) - a real wall-clock comparison, not
    // a dt-accumulated timer, so a fish that aged past its lifespan while the app was closed is
    // caught the moment it's next simulated rather than needing any offline catch-up logic (see the
    // `bornAt` doc comment in types.ts).
    if (inst.kind === 'fish' && !inst.dead && Date.now() - inst.bornAt >= inst.lifespanMs) {
      inst.dead = true;
      inst.diedAt = Date.now();
      inst.groupId = null;
      this.persist();
    }
    if (inst.kind === 'fish' && inst.dead) {
      // Floats straight up to the surface and stays there - no swimming, no frame animation, no
      // bobbing (frozen pose reads as "dead", not "resting"). Left in place horizontally rather than
      // drifting, since there's no current in this tank to drift on. Removed entirely by the user
      // clicking it (see onCanvasPointerDown), not by any timer here.
      if (!inst.isDragging) {
        const bounds = this.swimBoundsFor(inst);
        const dy = bounds.yMin - inst.y;
        if (Math.abs(dy) > 0.5) inst.y += Math.sign(dy) * Math.min(Math.abs(dy), 20 * dt);
      }
      return;
    }

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
      let steer = inst.groupId ? schoolSteer.get(inst.groupId) : undefined;
      let schooling = !!steer;

      // Hunger (P5 §6 item 2) takes priority over schooling - a hungry fish breaks formation to go
      // eat rather than waiting for the whole group to drift past a pellet. Reaching the food is
      // just steering `dir`/`targetY` toward it and letting the ordinary movement code below (same
      // x/y-approach logic driving every other fish) carry it there - no separate movement path
      // needed for "seeking".
      let seekingFood = false;
      if (this.foodItems.length) {
        const { pw: fpw, ph: fph } = this.spritePx(sprite);
        const cx = inst.x + fpw / 2;
        const cy = inst.y + fph / 2;
        const food = this.nearestFood(cx, cy);
        if (food) {
          const dist = Math.hypot(food.x - cx, food.y - cy);
          if (dist <= FOOD_EAT_RADIUS) {
            this.eatFood(inst, food.id);
          } else {
            steer = undefined;
            schooling = false;
            seekingFood = true;
            // Hysteresis, not a straight "always face the food" - recomputing `dir` from scratch
            // every frame flips it back and forth rapidly the moment the fish is hovering near the
            // food's x (any tiny frame-to-frame jitter crosses back and forth over cx===food.x),
            // which reads as a fast side-to-side shudder rather than swimming. Only correcting
            // course once actually FOOD_SEEK_DEADZONE past the food lets the fish's current heading
            // carry it through in one smooth diagonal pass - overshoot a little, then the normal
            // wall-bounce/course-correct below turns it back - exactly the "dive in at an angle,
            // swim back, repeat" pattern a real fish approaching food would show, not a vertical drop.
            const dxToFood = food.x - cx;
            if (Math.abs(dxToFood) > FOOD_SEEK_DEADZONE) inst.dir = dxToFood > 0 ? 1 : -1;
            inst.targetY = Math.max(bounds.yMin, Math.min(bounds.yMax, food.y - fph / 2));
          }
        }
      }
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
        if (!schooling && !seekingFood) inst.targetY = this.randomTargetYInBounds(bounds.yMin, bounds.yMax);
      }
      if (inst.x >= bounds.xMax) {
        inst.x = bounds.xMax;
        inst.dir = -1;
        if (!schooling && !seekingFood) inst.targetY = this.randomTargetYInBounds(bounds.yMin, bounds.yMax);
      }

      const dy = inst.targetY - inst.y;
      if (Math.abs(dy) < 2) {
        // Reaching the food's depth is not "arrived, pick something new" the way it is for an
        // ordinary wandering fish - staying level with it (not re-randomizing away) is what lets
        // the eat-radius check above actually connect the next time this fish's x sweeps back
        // across the food's x, instead of the fish darting off to some unrelated new depth right
        // as it gets close.
        if (!schooling && !seekingFood) inst.targetY = this.randomTargetYInBounds(bounds.yMin, bounds.yMax);
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
    // Water level (P5 §6 item 4) - the gradient only fills from the current surface down; whatever's
    // evaporated away above it reads as empty glass/air instead.
    const waterTop = this.waterTopY();

    if (waterTop > 0) {
      ctx.fillStyle = '#0d1a24';
      ctx.fillRect(0, 0, w, waterTop);
    }

    // The gradient is always the base layer - a background sprite is placed freely (see
    // BackgroundTransform) rather than forced to cover the whole tank, so whatever it doesn't cover
    // still needs to read as water rather than as a transparent hole.
    const grad = ctx.createLinearGradient(0, waterTop, 0, h);
    grad.addColorStop(0, '#7fd7e8');
    grad.addColorStop(1, '#0f6f97');
    ctx.fillStyle = grad;
    ctx.fillRect(0, waterTop, w, h - waterTop);

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

    // A bright waterline band right at the water's current surface - the glassy "surface glint" seen
    // in reference tank art, distinguishing the water's top edge from the glass/lid (or, once
    // evaporated some, the empty air) above it.
    const waterlineH = Math.max(3, h * 0.02);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(0, waterTop, w, waterlineH);
  }

  /** Translucent green bands creeping in from each edge of the glass (P5 §6 item 5) - a simplified
   *  stand-in for real per-region algae growth (see ALGAE_MAX_BAND_FRAC's doc comment): cheap to draw
   *  identically in both renderers, and corners piling up thicker where bands overlap happens to match
   *  how real tank algae actually accumulates anyway. Drawn right after the background/water, before
   *  anything else, so it reads as being on the glass rather than floating in the water. */
  private drawAlgae(): void {
    if (!this.ctx || this.algae <= 0 || !this.algaePatches.length) return;
    const ctx = this.ctx;
    const visibleCount = Math.round(this.algae * this.algaePatches.length);
    if (visibleCount <= 0) return;
    ctx.save();
    ctx.strokeStyle = '#4ade80';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 0; i < visibleCount; i++) {
      const patch = this.algaePatches[i];
      ctx.beginPath();
      ctx.moveTo(patch.x + patch.points[0].x, patch.y + patch.points[0].y);
      for (let p = 1; p < patch.points.length; p++) {
        ctx.lineTo(patch.x + patch.points[p].x, patch.y + patch.points[p].y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Small orange pellets (P5 §6 item 2) - drawn before fish so a fish eating one visually sits on top
   *  of it for the one frame both exist together. */
  private drawFoodItems(): void {
    if (!this.ctx || !this.foodItems.length) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = '#f5a623';
    this.foodItems.forEach((food) => {
      ctx.beginPath();
      ctx.arc(food.x, food.y, 4, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  /** Small brown clumps (P5 §6 item 3) - visually distinct from food's orange so the two never get
   *  confused, since they now share very similar behavior (settle near the bottom) but opposite
   *  purpose (eaten vs. collected). */
  private drawWasteItems(): void {
    if (!this.ctx || !this.wasteItems.length) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = '#6b4a2f';
    this.wasteItems.forEach((w) => {
      ctx.beginPath();
      ctx.ellipse(w.x, w.y, 3, 5, 0, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  private drawInstance(inst: Instance): void {
    if (!inst.visible) return;
    const sprite = this.spriteFor(inst);
    if (!sprite || !this.ctx) return;
    const { width, height } = this.spriteDims(sprite);
    // Growing (P5 §6 item 6) shrinks only what's drawn here - see growthScale()'s own doc comment for
    // why the swim-bounds footprint (spritePx(sprite) as everything else uses it) stays full adult
    // size regardless.
    const growth = inst.kind === 'fish' ? this.growthScale(inst) : 1;
    const full = this.spritePx(sprite);
    const pw = full.pw * growth;
    const ph = full.ph * growth;
    const layers = sprite.frames[inst.frameIndex % sprite.frames.length];
    const renderY = inst.y + (inst.kind === 'fish' && !inst.isDragging ? Math.sin(inst.bobPhase) * 3 : 0);

    this.ctx.save();
    // Dead (P5 §6 item 1) reads visually as "no longer alive" via desaturation - see the `dead` doc
    // comment in types.ts for why removal is click-driven rather than timed.
    this.ctx.filter = inst.dead ? 'grayscale(1)' : 'none';
    this.ctx.translate(inst.x + pw / 2, renderY + ph / 2);
    if (inst.kind === 'fish' && inst.dir < 0) this.ctx.scale(-1, 1);
    this.ctx.translate(-pw / 2, -ph / 2);
    paintLayers(this.ctx, layers, width, height, DISPLAY_SCALE * growth);
    this.ctx.restore();

    if (inst.id === this.selectedId || this.marqueeIds?.includes(inst.id)) {
      this.ctx.strokeStyle = '#ffeb3b';
      this.ctx.lineWidth = 2;
      this.ctx.strokeRect(inst.x - 2, renderY - 2, pw + 4, ph + 4);
    }

    // Hunger status bar (P5 §6 item 2, §9 Q3) - mirrors tankScene.ts's Pixi version so Build mode
    // (which can use either renderer - see rendererMode.ts) shows the same thing Life mode does.
    if (inst.kind === 'fish' && !inst.dead && inst.hunger < 1) {
      const barY = renderY - HUNGER_BAR_GAP - HUNGER_BAR_HEIGHT;
      this.ctx.fillStyle = 'rgba(0,0,0,0.4)';
      this.ctx.fillRect(inst.x, barY, pw, HUNGER_BAR_HEIGHT);
      this.ctx.fillStyle = inst.hunger > 0.5 ? '#4ade80' : inst.hunger > 0.2 ? '#facc15' : '#ef4444';
      this.ctx.fillRect(inst.x, barY, pw * Math.max(0, inst.hunger), HUNGER_BAR_HEIGHT);
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

  /** The tank's swim-area silhouette as a canvas path, for the draw-time clip - built from
   *  geometry.ts's pure ovalFlatTopGeometry/roundedCornerRadius (see docs/PIXI_MIGRATION_PLAN.md P3),
   *  the same functions clampCenterToShape (above) and tankScene.ts's Pixi renderer use, so all three
   *  are guaranteed to agree on where the shape's edge actually is - not just "kept in sync by eye"
   *  the way this and the Pixi version used to be before they shared one source of the math. */
  private shapePath(w: number, h: number): Path2D {
    const p = new Path2D();
    if (this.tankShape === 'oval') {
      const geo = ovalFlatTopGeometry(w, h, this.tankOvalTopCutFrac);
      if (!geo.hasCut) {
        p.ellipse(geo.cx, geo.cy, geo.rx, geo.ry, 0, 0, Math.PI * 2);
      } else {
        p.moveTo(geo.xLeft, geo.topCutY);
        p.lineTo(geo.xRight, geo.topCutY);
        p.ellipse(geo.cx, geo.cy, geo.rx, geo.ry, 0, geo.thetaRight, geo.thetaLeft, false);
        p.closePath();
      }
    } else if (this.tankShape === 'rounded') {
      const r = Math.max(0, Math.min(roundedCornerRadius(w, h, this.tankCornerRadiusFrac), w / 2, h / 2));
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

  /** `instances` (z-order) as-is - EXCEPT whatever's actively being dragged (and anything moving
   *  with it - its group, or the rest of a multi-selection) is moved to the end so it visually sits
   *  on top while moving, without ever touching the persisted array order (a mere click/drag must
   *  not reorder anything or jump rows around in the Layers panel - only explicit bring-to-front/
   *  send-to-back/panel-reorder should). Shared by draw() and visibleDrawOrder() below so a second
   *  renderer (the Pixi one added in P1 - see docs/PIXI_MIGRATION_PLAN.md) can mirror the exact same
   *  visual stacking without re-deriving the raised-while-dragging logic itself and risking it
   *  drifting out of sync with this one. */
  private computeDrawOrder(): Instance[] {
    if (!this.draggingInstance) return this.instances;
    const raised = new Set([this.draggingInstance.id, ...this.coMoversFor(this.draggingInstance)]);
    const back: Instance[] = [];
    const front: Instance[] = [];
    this.instances.forEach((inst) => (raised.has(inst.id) ? front : back).push(inst));
    return [...back, ...front];
  }

  /** Public read-only view of computeDrawOrder() - the current on-screen stacking order, for a
   *  renderer other than this engine's own Canvas2D draw() to mirror (the Pixi renderer added in
   *  P1). Never mutates `instances` itself; safe to call every frame. */
  visibleDrawOrder(): Instance[] {
    return this.computeDrawOrder();
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
    this.drawAlgae();

    if (this.selectedZone) this.strokeZoneRect(this.selectedZone, 'rgba(120, 255, 160, 0.9)');

    this.drawWasteItems();
    this.drawFoodItems();
    this.computeDrawOrder().forEach((inst) => this.drawInstance(inst));

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

/**
 * `options` is read once, when the engine is constructed - a live-switchable data source is not a real
 * use case (a shared tank is opened as its own view, see SharedTankView), and pretending otherwise
 * would mean tearing down and rebuilding a running simulation on any re-render whose caller happened
 * to pass a fresh object literal.
 */
export function useTank(options?: TankEngineOptions) {
  const engineRef = useRef<TankEngine | null>(null);
  const [, setTick] = useState(0);
  if (!engineRef.current) {
    engineRef.current = new TankEngine(options);
  }
  const engine = engineRef.current;

  useEffect(() => {
    // A tank that arrived from another device is already in local storage; reload it so it is on
    // screen. Unsaved local edits win: they are only in memory, so reloading would destroy them, and
    // the sync engine will carry them up on the next flush anyway. Someone else's tank is not part of
    // this browser's sync at all, so it never listens.
    const onTankSynced = () => {
      if (!engine.dirty) void engine.refresh(() => true);
    };
    if (!engine.readOnly) window.addEventListener('ft:tank-synced', onTankSynced);
    engine.init(() => setTick((t) => t + 1));
    engine.resizeCanvas();
    // Not awaited - the engine draws its empty initial tank until `ready` flips (see hydrate()).
    void engine.hydrate();
    const onResize = () => engine.resizeCanvas();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('ft:tank-synced', onTankSynced);
      engine.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return engine;
}
