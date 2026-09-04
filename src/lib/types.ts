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
  | 'move';

export type SymmetryMode = 'none' | 'vertical' | 'horizontal' | 'both';

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
}

/** A decoration placed in the area around the tank (kind 'room' sprites) rather than inside its
 *  swim space - can be dragged anywhere in that area, always renders above the tank frame (so it
 *  can overlap the tank), and never swims/animates/groups the way an in-tank Instance does. See
 *  TankEngine.roomInstances in useTank.ts. */
export interface RoomInstance {
  id: string;
  spriteId: string;
  /** Center position as a fraction (0..1) of the viewport's width/height - fraction-based so it
   *  stays proportionally put if the viewport is ever resized. Kept inset from 0/1 by a fixed
   *  margin (see ROOM_MARGIN_PX in useTank.ts) so it's never dropped flush against the outer edge. */
  xFrac: number;
  yFrac: number;
  visible: boolean;
}
