export type CellColor = string | null;
export type Frame = CellColor[];
export type SpriteType = 'fish' | 'object' | 'room' | 'background';
export type SwimSpeed = 'slow' | 'medium' | 'fast' | 'veryFast';
/** The tank's swim-area silhouette: 'rectangle' is the classic box, 'rounded' cuts its four corners
 *  on a radius, 'oval' inscribes an ellipse in the tank's bounding box (a round bowl look). Affects
 *  both what's drawn (TankEngine.draw's clip path) and where fish/decorations are actually allowed
 *  to sit (TankEngine.clampCenterToShape) - not purely cosmetic. */
export type TankShape = 'rectangle' | 'rounded' | 'oval';

/** Free-transform placement of the selected background sprite (see TankEngine.backgroundTransform
 *  in useTank.ts) - a Photoshop-Ctrl+T-style move/scale/rotate, not a crop/pan. x/y is the image's
 *  center in the tank canvas's own logical pixel space (same space as Instance.x/y); scale is a
 *  multiplier on the sprite's native pixel-art size (1 = drawn at the same px-per-cell as any other
 *  sprite); rotation is radians. */
export interface BackgroundTransform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  cells: Frame;
}

export interface Sprite {
  id: string | null;
  name: string;
  type: SpriteType;
  width: number;
  height: number;
  frames: Layer[][];
  /** Milliseconds each frame stays on screen during animation (editor preview and the tank). */
  frameMs: number;
}

export type ToolName =
  | 'pen'
  | 'eraser'
  | 'fill'
  | 'eyedropper'
  | 'line'
  | 'curve'
  | 'rect'
  | 'ellipse'
  | 'spray'
  | 'gradient'
  | 'select'
  | 'lasso'
  | 'magicWand'
  | 'move';

/** How onion-skin frames are colored: 'tint' recolors them by direction (red before, blue after) so
 *  which side a frame is on is unmistakable; 'original' keeps their own colors and only fades them. */
export type OnionColorMode = 'tint' | 'original';

/** Onion-skin preferences, persisted across sessions (see storage.loadOnionSettings). `before`/`after`
 *  are frame counts per direction, `opacity` the nearest frame's alpha. */
export type OnionSettings = {
  enabled: boolean;
  before: number;
  after: number;
  opacity: number;
  colorMode: OnionColorMode;
};

/** 'diagonal' mirrors across both diagonals through the (draggable) symmetry axis point - good for
 *  starfish/coral shapes; 'radial' rotates 90/180/270° around that same point instead of mirroring. */
export type SymmetryMode = 'none' | 'vertical' | 'horizontal' | 'both' | 'diagonal' | 'radial';

/** What a newly drawn selection does to the one already on the canvas: 'new' replaces it (the
 *  default), 'add' unions the two, 'subtract' cuts the new shape out of the old one. Shared by the
 *  marquee, the lasso and the Magic Wand so all three build up one selection together - this used to
 *  be a Magic-Wand-only behavior reachable only by holding a modifier, with nothing on screen saying
 *  it existed. */
export type SelectionMode = 'new' | 'add' | 'subtract';

/** How setGridSize() maps old pixel content onto a new canvas size: 'stretch' resamples (the original,
 *  only behavior), 'crop' keeps pixels at their original 1:1 position, anchored per ResizeAnchor, and
 *  either crops or pads with transparency as needed. */
export type ResizeMode = 'stretch' | 'crop';

/** 9-point anchor for a 'crop' resize (see ResizeMode) - which corner/edge/center of the old content
 *  stays put while the canvas grows/shrinks around it. */
export type ResizeAnchor =
  | 'top-left' | 'top-center' | 'top-right'
  | 'middle-left' | 'middle-center' | 'middle-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right';

export type CanvasBackground = 'checker-dark' | 'checker-light' | 'white' | 'black' | 'gray';

export type UiTheme =
  | 'cottonCandy'
  | 'watermelonCandy'
  | 'caramel'
  | 'lemonCake'
  | 'matcha'
  | 'blueberryMuffin'
  | 'ube'
  | 'blackSesame'
  | 'vanilla';

export interface Cell {
  x: number;
  y: number;
}

export interface SelectionBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A user-created, flat (non-nested) group of tank instances - see TankEngine in useTank.ts. */
export interface TankGroup {
  id: string;
  name: string;
  /** Confines every member's wandering/schooling to this rectangle (tank canvas coordinates) - null
   *  means the whole tank. Set by dragging a rectangle after arming the zone tool on a selected
   *  member (see TankEngine.armZoneTool). */
  zone: SelectionBox | null;
}

export interface Instance {
  id: string;
  spriteId: string;
  kind: SpriteType;
  x: number;
  y: number;
  dir: 1 | -1;
  vx: number;
  vy: number;
  targetY: number;
  frameIndex: number;
  frameTimer: number;
  bobPhase: number;
  isDragging: boolean;
  /** Only meaningful for kind 'fish'. */
  swimSpeed: SwimSpeed;
  /** id of the TankGroup this instance belongs to, or null. Fish in the same group school together
   *  and dragging any member moves the whole group. */
  groupId: string | null;
  /** Fixed per-instance vertical offset from the school's centroid, so grouped fish spread out instead of stacking. */
  schoolOffsetY: number;
  /** Confines this fish's wandering to this rectangle when ungrouped - see TankGroup.zone for the
   *  grouped equivalent (a grouped instance's own `zone` is ignored in favor of its group's). */
  zone: SelectionBox | null;
  /** Show/hide toggle from the Layers panel - hidden instances keep swimming/simulating, they just
   *  don't get painted (same "visibility doesn't touch data" convention as sprite Layer.visible). */
  visible: boolean;
  /** Epoch ms this instance was created. Only meaningful for kind 'fish' (see `lifespanMs`/`dead`) -
   *  set on every instance regardless of kind purely so the type has one shape, but decor never reads
   *  it. Real wall-clock time, not a simulation tick count, so a fish's age (and thus whether it's
   *  outlived `lifespanMs`) is correct even after the app was closed and reopened - see the P5 care
   *  loop design in docs/PIXI_MIGRATION_PLAN.md §9 Q1/§9.1 (real-time aging, no offline catch-up logic
   *  needed since age is always just `Date.now() - bornAt`). */
  bornAt: number;
  /** How long (ms) this fish lives before dying of old age - rolled once at birth (see
   *  `randomFishLifespanMs` in storage.ts) from the 18-30 real day range in docs/PIXI_MIGRATION_PLAN.md
   *  §9.1. Only meaningful for kind 'fish'. */
  lifespanMs: number;
  /** True once this fish has died (old age for now - P5 §6 item 1; sickness from starvation/dirty
   *  water is a later item in that same list). A dead fish stops swimming/animating and instead floats
   *  up toward the water's surface (see the `dead` branch in useTank.ts's update()), renders desaturated,
   *  and is removed by the user clicking it (see onCanvasPointerDown) rather than by any timer - per
   *  docs/PIXI_MIGRATION_PLAN.md §9 Q5, the "floats for 7 days" the user described is flavor for how
   *  long it lingers before the user is expected to notice and clean it up, not an auto-deletion rule. */
  dead: boolean;
  /** Epoch ms this fish died - 0 while alive. Only meaningful once `dead` is true. */
  diedAt: number;
  /** 0 (starving) .. 1 (full) - decays over real time (see tickHunger() in useTank.ts) and is restored
   *  by eating a food pellet dropped via feedAt() (P5 §6 item 2). Only meaningful for kind 'fish'. */
  hunger: number;
  /** Epoch ms `hunger` first reached 0, or 0 while not currently starving - cleared the moment hunger
   *  rises above 0 again (i.e. the fish eats). A fish starving continuously for
   *  STARVATION_DEATH_MS (docs/PIXI_MIGRATION_PLAN.md §9 Q2 - 4 real days) dies, via the same
   *  `dead`/`diedAt` fields old-age death uses - starvation is just a second way to trigger the same
   *  outcome, not a separate state. */
  starvingSince: number;
}

/** A single food pellet dropped into the tank (see TankEngine.feedAt / feedItems) - falls slowly
 *  through the water until a hungry fish reaches it, or forever if none does (P5 §6 item 2). */
export interface FoodItem {
  id: string;
  x: number;
  y: number;
  vy: number;
}

/** A decoration placed in the area around the tank (kind 'room' sprites) rather than inside its
 *  swim space - can be dragged anywhere in that area, always renders above the tank frame (so it
 *  can overlap the tank), and never swims/animates/groups the way an in-tank Instance does. See
 *  TankEngine.roomInstances in useTank.ts.
 *
 *  Position is the sprite's center in the SAME logical-pixel coordinate space as Instance.x/y - (0,0)
 *  is the tank's own top-left corner, (tankWidth, tankHeight) its bottom-right - just not clamped to
 *  that rectangle (that's the *swim* boundary, not the room's), only to a margin around it (see
 *  ROOM_MARGIN_FRAC in useTank.ts). Being expressed in the tank's own coordinate space, at the tank's
 *  own scale, rather than as a fraction of the browser viewport (the pre-P2 representation) is what
 *  lets a Pixi scene graph zoom room decor in lockstep with the tank automatically, simply by being
 *  the tank's own sibling in the same scaled container - no per-frame reprojection math needed (see
 *  docs/PIXI_MIGRATION_PLAN.md §7-B/§12/§13). storage.ts's normalizeRoomInstances() migrates the old
 *  xFrac/yFrac-of-viewport shape onto this one for existing saved tanks. */
export interface RoomInstance {
  id: string;
  spriteId: string;
  x: number;
  y: number;
  visible: boolean;
}
