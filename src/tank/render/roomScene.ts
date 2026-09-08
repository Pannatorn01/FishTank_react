import { Container, FillGradient, Graphics } from 'pixi.js';
import type { TankEngine } from '@/hooks/useTank';
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

export interface RoomSceneHandle {
  /** Repaints the room + the embedded tank from the engine's current state - call once per animation
   *  frame with the room viewport's current pixel size (i.e. the Pixi app's own renderer size). */
  render(engine: TankEngine, roomWidth: number, roomHeight: number): void;
  destroy(): void;
}

export function createRoomScene(stage: Container): RoomSceneHandle {
  const background = new Graphics();
  const floor = new Graphics();
  // The tank is rendered into its own sub-container rather than directly into `stage` so it can be
  // scaled/positioned as one unit to fit the room (see fitTankSlot below) without that transform
  // fighting createTankScene's own internal margin offset (see tankScene.ts's sceneRoot comment) -
  // that offset stays entirely inside tankSlot's local space either way.
  const tankSlot = new Container();
  stage.addChild(background, floor, tankSlot);

  const tankScene: TankSceneHandle = createTankScene(tankSlot);

  let lastRoomSizeKey = '';

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
  }

  function destroy(): void {
    tankScene.destroy();
    stage.removeChildren();
    background.destroy();
    floor.destroy();
  }

  return { render, destroy };
}
