import { Container, FillGradient, type FederatedPointerEvent, Graphics } from 'pixi.js';
import type { TankEngine } from '@/hooks/useTank';
import { roomSceneMargin } from '@/lib/storage';
import { createTankScene, type TankSceneHandle } from './tankScene';

/**
 * Life mode's scene (P4, docs/PIXI_MIGRATION_PLAN.md §6/§14/§9.2) - the tank placed inside a room, as
 * a preview only (no care mechanics yet, those are P5). Per §9.2 the user will supply real room
 * artwork later; until then this paints a flat placeholder gradient + floor band so the "tank sits
 * inside a room" layout can be built and tested without blocking on that asset.
 */
const WALL_TOP = 0x2c2438;
const WALL_BOTTOM = 0x1a1521;
const FLOOR_COLOR = 0x120d16;
const FLOOR_FRAC = 0.22;
/** The tank never fills the whole room - it's an object placed inside one, so it's kept to a fraction
 *  of the available floor space (both axes) no matter how big the room viewport or the tank itself. */
const TANK_FIT_FRAC = 0.62;
/** Tank cleanliness readout (P5 §6 item 3, §9 Q3 - "สถานะความสะอาดตู้") - a small fixed bar in the
 *  room's top-left corner, not tied to any one fish the way the hunger bars are. */
const CLEANLINESS_BAR_WIDTH = 90;
const CLEANLINESS_BAR_HEIGHT = 8;
const CLEANLINESS_BAR_MARGIN = 14;
/** Below this total drag distance (px), a pointerdown->pointerup is treated as a tap (collect waste,
 *  or feed if the Feed tool is armed) rather than a scrub - matches TAP_MOVE_THRESHOLD useTank.ts's
 *  own marquee/drag code uses for the same tap-vs-drag distinction. */
const TAP_VS_DRAG_THRESHOLD = 6;
/** Scrub brush (P5 §6 item 5) - a small sponge shown at the current drag point while the Scrub tool is
 *  armed and the user is actively dragging across the tank (see setArmedTool/the pointer state machine
 *  below), so the gesture reads as "wiping something off the glass" rather than an invisible drag.
 *  Sized relative to a typical fish sprite (see DISPLAY_SCALE in tankScene.ts - a 16-cell fish is
 *  ~64px) rather than the room/screen scale, since it's drawn in the tank's own local coordinate space
 *  (a child of tankSlot) and shrinks along with everything else in the tank when the room scales it
 *  down to fit. */
const SCRUB_BRUSH_WIDTH = 34;
const SCRUB_BRUSH_HEIGHT = 22;
const SCRUB_BRUSH_COLOR = 0xf4d35e;
const SCRUB_BRUSH_OUTLINE = 0x8a6d1f;
/** Predator (P5 §6 item 7) - sits on the room floor beside the tank (room-level coordinates, a sibling
 *  of tankSlot rather than a child of it - it's threatening the tank from outside, not swimming in the
 *  water). Tap it directly to scare it off before its countdown bar runs out. */
const CAT_COLOR = 0x6b4423;
const BIRD_COLOR = 0x4a6fa5;
const BEAK_COLOR = 0xf2a93b;
const PREDATOR_FLOOR_GAP = 6;
const PREDATOR_BAR_WIDTH = 40;
const PREDATOR_BAR_HEIGHT = 5;
const PREDATOR_BAR_OFFSET_Y = -34;

export type ArmedTool = 'feed' | 'scrub' | null;

export interface RoomSceneHandle {
  /** Repaints the room + the embedded tank from the engine's current state - call once per animation
   *  frame with the room viewport's current pixel size (i.e. the Pixi app's own renderer size). Also
   *  the only place `engine` reaches this scene, so the tap/drag handlers below (registered once, not
   *  per-frame) always act on whichever engine the *last* render() call was given - see currentEngine. */
  render(engine: TankEngine, roomWidth: number, roomHeight: number): void;
  /** Which tool (if any) is currently selected in the Life-mode toolbar (see LifePanel.tsx) - null
   *  means a tap only ever tries to collect waste, same as before P5's Feed/Scrub tools existed. */
  setArmedTool(tool: ArmedTool): void;
  destroy(): void;
}

export function createRoomScene(stage: Container): RoomSceneHandle {
  const background = new Graphics();
  const floor = new Graphics();
  const cleanlinessBar = new Graphics();
  // The tank is rendered into its own sub-container rather than directly into `stage` so it can be
  // scaled/positioned as one unit to fit the room (see fitTankSlot below) without that transform
  // fighting createTankScene's own internal margin offset (see tankScene.ts's sceneRoot comment) -
  // that offset stays entirely inside tankSlot's local space either way.
  const tankSlot = new Container();
  // Invisible - a click/drag target sized to the *actual* tank rectangle only (not the room-decor
  // margin around it - see fitTankSlot), so an action never lands just outside the glass in the
  // surrounding room (previously reported by the user: a food pellet stuck "beside" the tank that no
  // fish could ever reach, from a tap that was really in that margin).
  const tapHitArea = new Graphics();
  tapHitArea.eventMode = 'static';
  tapHitArea.cursor = 'pointer';
  tankSlot.addChild(tapHitArea);
  stage.addChild(background, floor, tankSlot, cleanlinessBar);

  const tankScene: TankSceneHandle = createTankScene(tankSlot);

  // Added *after* createTankScene() populates tankSlot with the actual tank (water/fish/etc, itself
  // opaque) - Pixi paints children in insertion order, so a marker added any earlier would render
  // first and then sit hidden underneath the water on every frame.
  const scrubBrush = new Graphics()
    .roundRect(-SCRUB_BRUSH_WIDTH / 2, -SCRUB_BRUSH_HEIGHT / 2, SCRUB_BRUSH_WIDTH, SCRUB_BRUSH_HEIGHT, 5)
    .fill(SCRUB_BRUSH_COLOR)
    .stroke({ width: 2, color: SCRUB_BRUSH_OUTLINE });
  for (let i = 1; i <= 3; i++) {
    const x = -SCRUB_BRUSH_WIDTH / 2 + (SCRUB_BRUSH_WIDTH * i) / 4;
    scrubBrush
      .moveTo(x, -SCRUB_BRUSH_HEIGHT / 2 + 3)
      .lineTo(x, SCRUB_BRUSH_HEIGHT / 2 - 3)
      .stroke({ width: 1.5, color: SCRUB_BRUSH_OUTLINE, alpha: 0.5 });
  }
  scrubBrush.eventMode = 'none';
  scrubBrush.visible = false;
  tankSlot.addChild(scrubBrush);

  // A sibling of tankSlot (room-level coordinates), added last so it draws on top of the tank/floor.
  const predatorContainer = new Container();
  predatorContainer.eventMode = 'static';
  predatorContainer.cursor = 'pointer';
  predatorContainer.visible = false;
  const predatorBody = new Graphics();
  const predatorTimerBar = new Graphics();
  predatorContainer.addChild(predatorBody, predatorTimerBar);
  stage.addChild(predatorContainer);
  predatorContainer.on('pointertap', () => currentEngine?.scarePredator());

  let lastRoomSizeKey = '';
  let lastHitAreaSizeKey = '';
  // Kept in sync every render() call (see fitTankSlot) so the pointer handlers below - registered
  // once, not per-frame - always convert against the tank's *current* margin offset rather than a
  // stale one captured at mount time.
  let tankMargin = { x: 0, y: 0 };
  let armedTool: ArmedTool = null;
  let currentEngine: TankEngine | null = null;
  let lastPredatorKind: 'cat' | 'bird' | null = null;

  function setArmedTool(tool: ArmedTool): void {
    armedTool = tool;
  }

  // One pointerdown/move/up state machine covers both gestures a tap on the tank can mean: a short tap
  // collects waste under it (or feeds there instead, if nothing was collected and the Feed tool is
  // armed - see endDrag), while an actual drag scrubs algae along the way, but *only* while the Scrub
  // tool is armed (an unarmed drag does nothing at all, on purpose - see the user's own framing this
  // was built from: pick a tool first, then use it on the tank).
  let dragStart: { x: number; y: number } | null = null;
  let lastDragPoint: { x: number; y: number } | null = null;
  let dragTotalDist = 0;

  const localPoint = (e: FederatedPointerEvent) => e.getLocalPosition(tankSlot);

  tapHitArea.on('pointerdown', (e: FederatedPointerEvent) => {
    const p = localPoint(e);
    dragStart = p;
    lastDragPoint = p;
    dragTotalDist = 0;
  });
  tapHitArea.on('globalpointermove', (e: FederatedPointerEvent) => {
    if (!lastDragPoint) return;
    const p = localPoint(e);
    const dist = Math.hypot(p.x - lastDragPoint.x, p.y - lastDragPoint.y);
    if (dist <= 0) return;
    dragTotalDist += dist;
    lastDragPoint = p;
    if (armedTool === 'scrub' && dragTotalDist > TAP_VS_DRAG_THRESHOLD) {
      currentEngine?.scrubAlgae(dist);
      scrubBrush.visible = true;
      scrubBrush.position.set(p.x, p.y);
    }
  });
  const endDrag = () => {
    if (dragStart && dragTotalDist <= TAP_VS_DRAG_THRESHOLD && currentEngine) {
      const tankX = dragStart.x - tankMargin.x;
      const tankY = dragStart.y - tankMargin.y;
      const collected = currentEngine.collectWasteAt(tankX, tankY);
      if (!collected && armedTool === 'feed') currentEngine.feedAt(tankX, tankY);
    }
    dragStart = null;
    lastDragPoint = null;
    dragTotalDist = 0;
    scrubBrush.visible = false;
  };
  tapHitArea.on('pointerup', endDrag);
  tapHitArea.on('pointerupoutside', endDrag);

  function paintRoom(roomWidth: number, roomHeight: number): void {
    const wallGradient = new FillGradient({
      type: 'linear',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      colorStops: [
        { offset: 0, color: WALL_TOP },
        { offset: 1, color: WALL_BOTTOM },
      ],
    });
    const floorHeight = roomHeight * FLOOR_FRAC;
    background.clear().rect(0, 0, roomWidth, roomHeight - floorHeight).fill(wallGradient);
    floor.clear().rect(0, roomHeight - floorHeight, roomWidth, floorHeight).fill(FLOOR_COLOR);
  }

  function fitTankSlot(engine: TankEngine, roomWidth: number, roomHeight: number): void {
    const w = engine.canvas?.width ?? 0;
    const h = engine.canvas?.height ?? 0;
    if (w <= 0 || h <= 0) {
      tankSlot.visible = false;
      return;
    }
    tankSlot.visible = true;
    const floorHeight = roomHeight * FLOOR_FRAC;
    const maxW = roomWidth * TANK_FIT_FRAC;
    const maxH = (roomHeight - floorHeight) * TANK_FIT_FRAC;
    const scale = Math.min(maxW / w, maxH / h, 1);
    tankSlot.scale.set(scale);
    // Centered horizontally, sitting on the floor line.
    tankSlot.position.set((roomWidth - w * scale) / 2, roomHeight - floorHeight - h * scale);

    const hitAreaSizeKey = `${w}:${h}`;
    if (hitAreaSizeKey !== lastHitAreaSizeKey) {
      lastHitAreaSizeKey = hitAreaSizeKey;
      const { marginX, marginY } = roomSceneMargin(w, h);
      tankMargin = { x: marginX, y: marginY };
      // Offset by the margin - the tank's own scene (createTankScene's sceneRoot) sits at exactly this
      // offset inside tankSlot's local space (see tankScene.ts's sceneRoot doc comment), so this rect
      // has to match it to actually cover the real glass rather than the room-decor margin beside it.
      tapHitArea.clear().rect(marginX, marginY, w, h).fill({ color: 0x000000, alpha: 0 });
    }
  }

  function drawCleanlinessBar(engine: TankEngine): void {
    const cleanliness = engine.tankCleanliness;
    cleanlinessBar.clear();
    cleanlinessBar
      .rect(0, 0, CLEANLINESS_BAR_WIDTH, CLEANLINESS_BAR_HEIGHT)
      .fill({ color: 0x000000, alpha: 0.4 });
    const fillColor = cleanliness > 0.5 ? 0x4ade80 : cleanliness > 0.2 ? 0xfacc15 : 0xef4444;
    cleanlinessBar.rect(0, 0, CLEANLINESS_BAR_WIDTH * Math.max(0, cleanliness), CLEANLINESS_BAR_HEIGHT).fill(fillColor);
    cleanlinessBar.position.set(CLEANLINESS_BAR_MARGIN, CLEANLINESS_BAR_MARGIN);
  }

  function drawCatShape(g: Graphics): void {
    g.clear();
    g.ellipse(0, 4, 16, 11).fill(CAT_COLOR);
    g.poly([-14, -2, -8, -14, -4, -2]).fill(CAT_COLOR);
    g.poly([4, -2, 8, -14, 14, -2]).fill(CAT_COLOR);
  }

  function drawBirdShape(g: Graphics): void {
    g.clear();
    g.ellipse(0, 0, 14, 10).fill(BIRD_COLOR);
    g.poly([-4, -4, -18, -10, -6, 2]).fill(BIRD_COLOR);
    g.poly([12, -2, 20, 0, 12, 2]).fill(BEAK_COLOR);
  }

  /** Room-level (not tank-local) - `predator.xFrac` is a fraction of the room's own width, sitting on
   *  the floor line beside the tank, not inside the water (see PredatorEvent's own doc comment in
   *  types.ts for why). */
  function drawPredator(engine: TankEngine, roomWidth: number, roomHeight: number): void {
    const predator = engine.predator;
    if (!predator) {
      predatorContainer.visible = false;
      return;
    }
    predatorContainer.visible = true;
    if (predator.kind !== lastPredatorKind) {
      lastPredatorKind = predator.kind;
      if (predator.kind === 'cat') drawCatShape(predatorBody);
      else drawBirdShape(predatorBody);
    }
    const floorHeight = roomHeight * FLOOR_FRAC;
    predatorContainer.position.set(predator.xFrac * roomWidth, roomHeight - floorHeight - PREDATOR_FLOOR_GAP);

    const totalMs = Math.max(1, predator.expiresAt - predator.spawnedAt);
    const remainingFrac = Math.max(0, Math.min(1, (predator.expiresAt - Date.now()) / totalMs));
    predatorTimerBar.clear();
    predatorTimerBar
      .rect(-PREDATOR_BAR_WIDTH / 2, PREDATOR_BAR_OFFSET_Y, PREDATOR_BAR_WIDTH, PREDATOR_BAR_HEIGHT)
      .fill({ color: 0x000000, alpha: 0.4 });
    const barColor = remainingFrac > 0.5 ? 0x4ade80 : remainingFrac > 0.2 ? 0xfacc15 : 0xef4444;
    predatorTimerBar
      .rect(-PREDATOR_BAR_WIDTH / 2, PREDATOR_BAR_OFFSET_Y, PREDATOR_BAR_WIDTH * remainingFrac, PREDATOR_BAR_HEIGHT)
      .fill(barColor);
  }

  function render(engine: TankEngine, roomWidth: number, roomHeight: number): void {
    currentEngine = engine;
    if (roomWidth <= 0 || roomHeight <= 0) return;
    const roomSizeKey = `${roomWidth}:${roomHeight}`;
    if (roomSizeKey !== lastRoomSizeKey) {
      lastRoomSizeKey = roomSizeKey;
      paintRoom(roomWidth, roomHeight);
    }
    fitTankSlot(engine, roomWidth, roomHeight);
    tankScene.render(engine);
    drawCleanlinessBar(engine);
    drawPredator(engine, roomWidth, roomHeight);
  }

  function destroy(): void {
    tankScene.destroy();
    // tankScene.destroy() only tears down its own sceneRoot (removing itself from tankSlot as a side
    // effect) - tapHitArea/scrubBrush are tankSlot's own direct children, torn down here instead.
    tankSlot.destroy({ children: true });
    stage.removeChildren();
    background.destroy();
    floor.destroy();
    cleanlinessBar.destroy();
    predatorContainer.destroy({ children: true });
  }

  return { render, setArmedTool, destroy };
}
