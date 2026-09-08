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
/** Below this total drag distance (px), a pointerdown->pointerup is treated as a tap (feed/collect)
 *  rather than a scrub - matches the TAP_MOVE_THRESHOLD useTank.ts's own marquee/drag code uses for
 *  the same tap-vs-drag distinction. */
const TAP_VS_DRAG_THRESHOLD = 6;

export interface RoomSceneHandle {
  /** Repaints the room + the embedded tank from the engine's current state - call once per animation
   *  frame with the room viewport's current pixel size (i.e. the Pixi app's own renderer size). */
  render(engine: TankEngine, roomWidth: number, roomHeight: number): void;
  destroy(): void;
}

export function createRoomScene(
  stage: Container,
  onTap?: (tankX: number, tankY: number) => void,
  onScrub?: (dragDistancePx: number) => void,
): RoomSceneHandle {
  const background = new Graphics();
  const floor = new Graphics();
  const cleanlinessBar = new Graphics();
  // The tank is rendered into its own sub-container rather than directly into `stage` so it can be
  // scaled/positioned as one unit to fit the room (see fitTankSlot below) without that transform
  // fighting createTankScene's own internal margin offset (see tankScene.ts's sceneRoot comment) -
  // that offset stays entirely inside tankSlot's local space either way.
  const tankSlot = new Container();
  // Invisible - just a click target the size of the whole margin-inclusive tank scene (see
  // tankScene.ts's sceneRoot doc comment for what that margin is), sitting behind everything else in
  // tankSlot so a tap anywhere on the tank (including its room-decor margin) reports a position
  // without needing its own hit-test against the actual water shape - handleTankTap() already clamps
  // whatever it's given into the tank's bounds when it falls through to feedAt(), so an approximate
  // hit area costs nothing but an occasional pellet landing right at the glass instead of exactly
  // where tapped (collecting waste, the other half of handleTankTap, already needs to be reasonably
  // close to the waste item itself regardless).
  const tapHitArea = new Graphics();
  tapHitArea.eventMode = onTap || onScrub ? 'static' : 'none';
  tapHitArea.cursor = 'pointer';
  tankSlot.addChild(tapHitArea);
  stage.addChild(background, floor, tankSlot, cleanlinessBar);

  const tankScene: TankSceneHandle = createTankScene(tankSlot);

  let lastRoomSizeKey = '';
  // Kept in sync every render() call (see fitTankSlot) so the pointer handlers below - registered
  // once, not per-frame - always convert a tap against the tank's *current* margin offset rather than
  // a stale one captured at mount time.
  let tankMargin = { x: 0, y: 0 };

  // One pointerdown/move/up state machine covers both gestures (tap to feed/collect, drag to scrub
  // algae - P5 §6 items 2/3/5) rather than a plain 'pointertap' listener, since telling them apart
  // needs the total distance traveled: short movement is a tap (fires onTap once, at the down
  // position), anything past TAP_VS_DRAG_THRESHOLD is a scrub instead (fires onScrub continuously as
  // it moves, never also fires onTap for the same gesture).
  if (onTap || onScrub) {
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
      if (dragTotalDist > TAP_VS_DRAG_THRESHOLD) onScrub?.(dist);
    });
    const endDrag = () => {
      if (dragStart && dragTotalDist <= TAP_VS_DRAG_THRESHOLD) {
        onTap?.(dragStart.x - tankMargin.x, dragStart.y - tankMargin.y);
      }
      dragStart = null;
      lastDragPoint = null;
      dragTotalDist = 0;
    };
    tapHitArea.on('pointerup', endDrag);
    tapHitArea.on('pointerupoutside', endDrag);
  }

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

  let lastHitAreaSizeKey = '';

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
      const { marginX, marginY, sceneWidth, sceneHeight } = roomSceneMargin(w, h);
      tankMargin = { x: marginX, y: marginY };
      tapHitArea.clear().rect(0, 0, sceneWidth, sceneHeight).fill({ color: 0x000000, alpha: 0 });
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

  function render(engine: TankEngine, roomWidth: number, roomHeight: number): void {
    if (roomWidth <= 0 || roomHeight <= 0) return;
    const roomSizeKey = `${roomWidth}:${roomHeight}`;
    if (roomSizeKey !== lastRoomSizeKey) {
      lastRoomSizeKey = roomSizeKey;
      paintRoom(roomWidth, roomHeight);
    }
    fitTankSlot(engine, roomWidth, roomHeight);
    tankScene.render(engine);
    drawCleanlinessBar(engine);
  }

  function destroy(): void {
    tankScene.destroy();
    stage.removeChildren();
    background.destroy();
    floor.destroy();
    cleanlinessBar.destroy();
  }

  return { render, destroy };
}
