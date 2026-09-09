import {
  Container,
  FillGradient,
  type FederatedPointerEvent,
  Graphics,
  Sprite as PixiSprite,
  Rectangle,
} from 'pixi.js';
import type { TankEngine } from '@/hooks/useTank';
import {
  CAT_VARIANTS,
  type CatPose,
  type CatVariant,
  catSpriteName,
  EMOTE_SPRITE_NAMES,
  type EmoteKind,
  PACK_SPRITE_NAMES,
} from '@/lib/data/pixellabPack';
import { buildCastSprites, castRoomSprite, roomSceneMargin } from '@/lib/storage';
import type { PredatorPhase, Sprite } from '@/lib/types';
import { createTankScene, type TankSceneHandle } from './tankScene';
import { textureFor } from './textureCache';

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
 *  down to fit.
 *
 *  Drawn from the pixel-art sponge in the art pack; the flat rounded rectangle below is only the
 *  fallback for a build with no art, and looked like exactly what it was next to pixel-art fish. */
const SCRUB_BRUSH_WIDTH = 34;
const SCRUB_BRUSH_HEIGHT = 22;
const SCRUB_BRUSH_COLOR = 0xf4d35e;
const SCRUB_BRUSH_OUTLINE = 0x8a6d1f;
/** Predator (P5 §6 item 7) - sits on the room floor beside the tank (room-level coordinates, a sibling
 *  of tankSlot rather than a child of it - it's threatening the tank from outside, not swimming in the
 *  water). Tap it directly to scare it off before its countdown bar runs out. */
const CAT_COLOR = 0x6b4423;
const PREDATOR_FLOOR_GAP = 6;
const PREDATOR_BAR_WIDTH = 40;
const PREDATOR_BAR_HEIGHT = 5;
const PREDATOR_BAR_OFFSET_Y = -34;
/** Padding around the cat's drawn pixels for the tap target, in px. A cat is ~40px tall on a
 *  typical room viewport, and a target that hugs its outline exactly is a hard thing to hit with a
 *  thumb - especially mid-pounce, when it is moving. */
const PREDATOR_TAP_PADDING = 10;
/** Tap target used when there is no artwork to measure, i.e. the drawn fallback shape (see
 *  drawCatShape, which is about 32x28 around its own origin). */
const PREDATOR_FALLBACK_TAP = new Rectangle(-26, -34, 52, 52);
/**
 * Where the things in the room belong, as fractions of the backdrop artwork's own width and height -
 * not of the viewport. Measured off the shipped room art (pixellab-assets/room-window-348x224.png, a
 * table in front of a curtained window): the table top edge is at y=164 of 224, the table spans
 * x=88..262 of 348, the floorboards start at y=200, and the curtain rod crosses the top at y=16.
 *
 * Art fractions, not viewport fractions, are the whole point: the tank has to stand *on the painted
 * table* and the cat *on the painted floor*, so their anchors have to follow the artwork when the
 * window is resized. That is also why fitRoomBackground letterboxes rather than crops - a cover-fit
 * would slide the table out from under the tank as the viewport changed shape.
 *
 * These are tuned to that one picture. Another room backdrop with its table somewhere else needs its
 * own numbers; there is no way to find a painted table automatically.
 */
const ROOM_ART = {
  tableCenterXFrac: 0.5,
  tableTopYFrac: 164 / 224,
  tableWidthFrac: (262 - 88) / 348,
  floorTopYFrac: 200 / 224,
  /** Where each cat sleeps along the floorboards, in the order CAT_VARIANTS lists them. Two are
   *  left of the table's near leg and clear of the curtain; the third takes the strip of floor on
   *  the far side, which the tank never covers either. Spread wide enough that three cats read as
   *  three animals rather than one pile. */
  catXFracs: [0.1, 0.34, 0.72],
} as const;
/** How much of the painted table's width the tank is allowed to take up. Under 1 so the glass reads
 *  as standing on the table rather than overhanging both ends of it. */
const TANK_ON_TABLE_FRAC = 0.86;
/**
 * Sizes of the cast, as fractions of the artwork's *width*, measured against each sprite's drawn
 * pixels rather than its canvas (see contentBox).
 *
 * Width, not height: the poses have quite different proportions - a sleeping cat is a low curl, a
 * pouncing one is stretched out long - and matching them on height would make the sleeping one come
 * out much the larger of the two. Matching on width keeps one animal the same size as itself.
 *
 * Narrower than the single cat this room used to hold: three of them share the same floor.
 */
const CAT_WIDTH_FRAC = 0.1;
/** A raiding cat is up on the table rather than down on the floor, so it is sized against the
 *  table rather than the room - roughly a third of the table's height. */
const CAT_RAID_WIDTH_FRAC = 0.12;
/** Which pose each stage of a raid is drawn in. A fleeing cat reuses the walk cycle rather than the
 *  generated run: at this size the two read the same, and the run would cost three more sprites in
 *  the user's library for no visible difference. */
const PHASE_POSE: Record<PredatorPhase, CatPose> = {
  approach: 'walking',
  stalk: 'sitting',
  pounce: 'pouncing',
  flee: 'walking',
  feast: 'eating',
};
/** The phases that happen on the floor on the way to the tank, rather than up beside the glass. A
 *  cat walking in is crossing the floorboards; only once it settles does it get up to the table. */
const FLOOR_PHASES: ReadonlySet<PredatorPhase> = new Set<PredatorPhase>(['approach', 'flee']);
/** What the raiding cat is thinking at each stage. The angry face on a fleeing cat is doing real
 *  work: the flee pose is the walk cycle mirrored, which on its own says "leaving", not "you won" -
 *  the bubble is what makes a successful scare feel like one. */
const PHASE_EMOTE: Record<PredatorPhase, EmoteKind> = {
  approach: 'hungry',
  stalk: 'hungry',
  pounce: 'hungry',
  flee: 'angry',
  feast: 'happy',
};
/** Bubble width as a fraction of the artwork, applied to every emote's drawn pixels. The four
 *  bubbles came out of PixelLab at noticeably different sizes; sizing them all by content width
 *  here is what stops them popping bigger and smaller as the mood changes. */
const EMOTE_WIDTH_FRAC = 0.055;
/** Gap between the top of an animal and the bottom of its bubble, in fractions of the artwork's
 *  height, so the bubble floats clear of the head at any window size. */
const EMOTE_GAP_FRAC = 0.02;
/** The sleeping cats take turns showing a sleepy bubble rather than all wearing one at once: three
 *  permanent bubbles read as UI clutter, while one drifting between them reads as a quiet room. */
const SLEEPY_CYCLE_MS = 9_000;
/** How much of each turn the bubble is actually up for - the rest of the cycle nobody shows one. */
const SLEEPY_VISIBLE_FRAC = 0.45;
/** How long each frame of an awake animal's animation holds. Only the awake poses animate - a
 *  sleeping animal is deliberately a still frame, per the brief: they stir only when they come for
 *  the fish. */
const CAST_FRAME_MS = 220;
/** Fallback hold per frame for an animated room backdrop whose sprite carries no frameMs of its own.
 *  Slower than the cast: a backdrop's motion is drifting clouds and a swaying curtain, which read as
 *  atmosphere at this pace and as a flicker at the cast's. */
const BACKDROP_FRAME_MS = 500;

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
  // The chosen room artwork, painted over the placeholder wall/floor. A plain Sprite rather than a
  // Graphics fill: it is a pixel-art texture from the same textureCache the tank's own sprites use.
  const roomBackdrop = new PixiSprite();
  roomBackdrop.visible = false;
  roomBackdrop.eventMode = 'none';
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
  stage.addChild(background, floor, roomBackdrop, tankSlot, cleanlinessBar);

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
  // The pixel-art sponge, drawn in place of the shape above whenever the art is there. Both are
  // moved together by the drag handler; only one is ever visible.
  const scrubBrushSprite = new PixiSprite();
  scrubBrushSprite.eventMode = 'none';
  scrubBrushSprite.visible = false;
  scrubBrushSprite.anchor.set(0.5);
  const brushArt = castSprite(PACK_SPRITE_NAMES.scrubBrush);
  if (brushArt) {
    scrubBrushSprite.texture = textureFor(brushArt);
    // Matched to the shape it replaces on width, so the sponge stays the size the gesture was tuned
    // for rather than however many cells the artist happened to draw on.
    const scale = SCRUB_BRUSH_WIDTH / (scrubBrushSprite.texture.width || 1);
    scrubBrushSprite.scale.set(scale);
  }
  tankSlot.addChild(scrubBrushSprite);

  /** Shows the sponge at a tank-local point, preferring the artwork over the drawn shape. */
  function showScrubBrush(x: number, y: number): void {
    const usingArt = Boolean(brushArt);
    scrubBrushSprite.visible = usingArt;
    scrubBrush.visible = !usingArt;
    scrubBrushSprite.position.set(x, y);
    scrubBrush.position.set(x, y);
  }

  function hideScrubBrush(): void {
    scrubBrush.visible = false;
    scrubBrushSprite.visible = false;
  }

  // The residents: the three cats that live in the room and are simply asleep most of the time.
  // Siblings of tankSlot in room coordinates, added before the predator container so a raiding cat
  // draws over its own sleeping self if the two ever overlap. One view per coat, in CAT_VARIANTS
  // order, so each keeps its own texture between frames instead of the three fighting over one.
  const catResidents = CAT_VARIANTS.map(() => new PixiSprite());
  for (const resident of catResidents) {
    resident.visible = false;
    resident.eventMode = 'none';
    // The real anchor is set per sprite from its content box - see placeCastMember.
    stage.addChild(resident);
  }
  // Emote bubbles: one shared between the sleeping cats (only ever one is up at a time - see
  // SLEEPY_CYCLE_MS) and one for whichever cat is raiding. Both sit at room level rather than
  // inside any animal, so a bubble is never scaled or mirrored along with the cat under it.
  const residentEmote = new PixiSprite();
  const predatorEmote = new PixiSprite();
  for (const emote of [residentEmote, predatorEmote]) {
    emote.visible = false;
    emote.eventMode = 'none';
    stage.addChild(emote);
  }

  // A sibling of tankSlot (room-level coordinates), added last so it draws on top of the tank/floor.
  const predatorContainer = new Container();
  predatorContainer.eventMode = 'static';
  predatorContainer.cursor = 'pointer';
  predatorContainer.visible = false;
  const predatorBody = new Graphics();
  // The pixel-art pose used when the pack's artwork is present; predatorBody's drawn shapes stay as
  // the fallback for a library that never seeded it (or renamed it - see PACK_SPRITE_NAMES).
  const predatorSprite = new PixiSprite();
  predatorSprite.visible = false;
  predatorSprite.eventMode = 'none';
  const predatorTimerBar = new Graphics();
  // An explicit hit area, resized to the cat every frame (see drawPredator). Without one, a
  // container is hit-tested against its children - and the pose sprite is eventMode 'none' while
  // the fallback body is hidden whenever the artwork is present, so the only thing left to tap was
  // the countdown bar. That worked only while the bar was always drawn; the moment it became
  // pounce-only, most of a raid became untappable.
  predatorContainer.hitArea = PREDATOR_FALLBACK_TAP;
  predatorContainer.addChild(predatorBody, predatorSprite, predatorTimerBar);
  stage.addChild(predatorContainer);
  predatorContainer.on('pointertap', () => currentEngine?.scarePredator());

  let lastRoomSizeKey = '';
  let lastHitAreaSizeKey = '';
  // Kept in sync every render() call (see fitTankSlot) so the pointer handlers below - registered
  // once, not per-frame - always convert against the tank's *current* margin offset rather than a
  // stale one captured at mount time.
  let tankMargin = { x: 0, y: 0 };
  /** Where the backdrop artwork actually landed in the viewport after letterboxing - the coordinate
   *  space every ROOM_ART fraction is measured in. Falls back to the whole viewport when there is no
   *  backdrop, so the placeholder wall still gets a sane cast/tank placement. */
  let artRect = { x: 0, y: 0, width: 0, height: 0 };
  let armedTool: ArmedTool = null;
  let currentEngine: TankEngine | null = null;
  let lastPredatorVariant: CatVariant | null = null;

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
      showScrubBrush(p.x, p.y);
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
    hideScrubBrush();
  };
  tapHitArea.on('pointerup', endDrag);
  tapHitArea.on('pointerupoutside', endDrag);

  /** Sprites are addressed by name here, not id - see PACK_SPRITE_NAMES. Returns undefined when the
   *  library has no such sprite, which every caller treats as "fall back to the drawn shape". */
  /** The cast's own art, straight out of the pack rather than out of the user's library - see
   *  storage.buildCastSprites. Nothing to fall back to if a name is missing: an absent cast entry
   *  is a generator bug, not a library the user has edited. */
  function castSprite(name: string): Sprite | undefined {
    return buildCastSprites().get(name);
  }

  /** The drawn pixels' bounding box within a sprite's canvas, in cells. Cached per sprite id: it is a
   *  full scan of every cell of every layer, and it runs from a per-frame render path.
   *
   *  Needed because a pixel-art sprite is rarely drawn edge to edge - the sleeping cat sits in the
   *  bottom third of its 32x32 canvas. Sizing and positioning against the canvas instead of the drawn
   *  pixels is what made the cat too small and left it floating above the floorboards. */
  const contentBoxes = new Map<string, { x: number; y: number; width: number; height: number }>();

  function contentBox(sprite: Sprite): { x: number; y: number; width: number; height: number } {
    const cached = contentBoxes.get(sprite.id);
    if (cached) return cached;
    const width = sprite.width || 16;
    const height = sprite.height || 16;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (const layer of sprite.frames[0] ?? []) {
      if (!layer.visible) continue;
      for (let i = 0; i < layer.cells.length; i++) {
        if (layer.cells[i] === null) continue;
        const x = i % width;
        const y = (i - x) / width;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    // An entirely blank sprite has no drawn pixels to measure - treat the whole canvas as the box so
    // the caller still gets sane (if invisible) geometry rather than a negative size.
    const box =
      maxX < 0
        ? { x: 0, y: 0, width, height }
        : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
    contentBoxes.set(sprite.id, box);
    return box;
  }

  /** Paints one animal at an art-relative spot: `xFrac`/`yFrac` and `heightFrac` are all fractions of
   *  the backdrop artwork (see ROOM_ART), so the cast follows the picture rather than the window. The
   *  sprite's bottom-centre lands on the given point. Frames cycle only if `animate` is set.
   *
   *  Returns the viewport y of the *top* of the drawn pixels, or null if there was no sprite to
   *  draw. Callers that stack something above an animal (an emote bubble) need that number, and it
   *  is only knowable here: the canvas around a pose is mostly empty, so the sprite's own y and
   *  height say nothing about where the animal's head actually is. */
  function placeCastMember(
    view: PixiSprite,
    sprite: Sprite | undefined,
    xFrac: number,
    yFrac: number,
    widthFrac: number,
    animate: boolean,
  ): number | null {
    if (!sprite) {
      view.visible = false;
      return null;
    }
    const frameCount = Math.max(1, sprite.frames.length);
    const frameIndex = animate ? Math.floor(Date.now() / CAST_FRAME_MS) % frameCount : 0;
    view.texture = textureFor(sprite, frameIndex);
    const cellsWide = sprite.width || 16;
    const cellsHigh = sprite.height || 16;
    const box = contentBox(sprite);
    // Scale so the *drawn* pixels come out widthFrac of the artwork wide; the canvas around them is
    // scaled to match and simply stays transparent.
    const cellPx = (artRect.width * widthFrac) / box.width;
    view.width = cellsWide * cellPx;
    view.height = cellsHigh * cellPx;
    // Anchoring on the content box's bottom-centre (rather than the canvas's) is what puts the cat's
    // belly on the floorboards instead of leaving it hovering over them by however many blank rows
    // the artist happened to leave below it.
    view.anchor.set((box.x + box.width / 2) / cellsWide, (box.y + box.height) / cellsHigh);
    const bottomY = artRect.y + artRect.height * yFrac;
    view.position.set(artRect.x + artRect.width * xFrac, bottomY);
    view.visible = true;
    return bottomY - box.height * cellPx;
  }

  /** The backdrop actually shown. A background the user picked wins; otherwise the room falls back
   *  to its own shipped artwork, which no longer lives in the library and so cannot be deleted out
   *  from under the scene. Only a build with no cast art at all drops through to the placeholder
   *  wall painted underneath. */
  function effectiveRoomSprite(engine: TankEngine): Sprite | undefined {
    const backgrounds = engine.sprites.filter((s) => s.type === 'background' && s.deletedAt === 0);
    const chosen = engine.roomBackgroundSpriteId
      ? backgrounds.find((s) => s.id === engine.roomBackgroundSpriteId)
      : undefined;
    return chosen ?? castRoomSprite();
  }

  /** Letterboxes the chosen backdrop into the viewport - see ROOM_ART for why this is a contain-fit
   *  and not a cover-fit. The placeholder wall/floor stays painted underneath, so the bars beside a
   *  backdrop whose aspect does not match the viewport read as the rest of the room rather than as
   *  empty canvas. */
  function fitRoomBackground(engine: TankEngine, roomWidth: number, roomHeight: number): void {
    const sprite = effectiveRoomSprite(engine);
    if (!sprite) {
      roomBackdrop.visible = false;
      artRect = { x: 0, y: 0, width: roomWidth, height: roomHeight };
      return;
    }
    const cellsWide = sprite.width || 16;
    const cellsHigh = sprite.height || 16;
    // A backdrop with several frames is an animated room - drifting sky, a curtain moving. One frame
    // is the still case and costs the same code path.
    const frameCount = Math.max(1, sprite.frames.length);
    const frameIndex =
      frameCount > 1 ? Math.floor(Date.now() / (sprite.frameMs || BACKDROP_FRAME_MS)) % frameCount : 0;
    // Rasterized at 1x, not the usual 4x: the backdrop is scaled to the viewport a few lines below,
    // so the extra density would be thrown away - and an 8-frame animated room at 4x is ~38MB of
    // texture instead of ~2MB.
    roomBackdrop.texture = textureFor(sprite, frameIndex, 1);
    const scale = Math.min(roomWidth / cellsWide, roomHeight / cellsHigh);
    roomBackdrop.width = cellsWide * scale;
    roomBackdrop.height = cellsHigh * scale;
    roomBackdrop.position.set((roomWidth - roomBackdrop.width) / 2, (roomHeight - roomBackdrop.height) / 2);
    roomBackdrop.visible = true;
    artRect = { x: roomBackdrop.x, y: roomBackdrop.y, width: roomBackdrop.width, height: roomBackdrop.height };
  }

  /** The three cats that live in the room. Each is shown asleep unless it is the one currently
   *  raiding the tank, in which case drawPredator draws it up at the glass instead and this leaves
   *  its spot on the floor empty - the same cat cannot be both asleep in the corner and pouncing.
   *
   *  The sleeping pose animates, unlike the old still frame: it is a slow breathing loop (420ms a
   *  frame, set in genpack.py) rather than motion, and a room where nothing at all moves reads as a
   *  frozen screenshot. */
  function drawResidents(engine: TankEngine): void {
    const raiding = engine.predator?.variant ?? null;
    const headYs = CAT_VARIANTS.map((variant, i) =>
      placeCastMember(
        catResidents[i],
        raiding === variant ? undefined : castSprite(catSpriteName(variant, 'asleep')),
        ROOM_ART.catXFracs[i],
        ROOM_ART.floorTopYFrac,
        CAT_WIDTH_FRAC,
        true,
      ),
    );
    drawSleepyBubble(headYs);
  }

  /** One sleepy bubble at a time, moving from cat to cat and going away between turns. A cat that
   *  is off raiding is skipped rather than given an empty turn: the bubble would be floating over
   *  a patch of empty floorboards. */
  function drawSleepyBubble(headYs: (number | null)[]): void {
    const cycle = Date.now() % (SLEEPY_CYCLE_MS * CAT_VARIANTS.length);
    const slot = Math.floor(cycle / SLEEPY_CYCLE_MS);
    const withinSlot = (cycle % SLEEPY_CYCLE_MS) / SLEEPY_CYCLE_MS;
    const headY = headYs[slot];
    if (withinSlot > SLEEPY_VISIBLE_FRAC || headY === null) {
      residentEmote.visible = false;
      return;
    }
    placeEmote(residentEmote, 'sleepy', ROOM_ART.catXFracs[slot], headY);
  }

  /** Puts a bubble immediately above something whose top edge is at `headY` (viewport px, as
   *  placeCastMember returns). Sized by content width so every mood comes out the same size. */
  function placeEmote(
    view: PixiSprite,
    kind: EmoteKind,
    xFrac: number,
    headY: number,
  ): void {
    const gap = artRect.height * EMOTE_GAP_FRAC;
    const bottomYFrac = artRect.height > 0 ? (headY - gap - artRect.y) / artRect.height : 0;
    placeCastMember(view, castSprite(EMOTE_SPRITE_NAMES[kind]), xFrac, bottomYFrac, EMOTE_WIDTH_FRAC, false);
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

  function fitTankSlot(engine: TankEngine): void {
    const w = engine.canvas?.width ?? 0;
    const h = engine.canvas?.height ?? 0;
    if (w <= 0 || h <= 0) {
      tankSlot.visible = false;
      return;
    }
    tankSlot.visible = true;
    // The glass is not tankSlot's whole content: createTankScene offsets its scene by the room-decor
    // margin (see tankScene.ts's sceneRoot), so the water sits at (marginX, marginY) inside this
    // container. Centering tankSlot itself is what pushed the tank down and to the right of the table
    // - the placement has to be computed for the glass rectangle, then the container moved so that
    // rectangle lands where it belongs.
    const { marginX, marginY } = roomSceneMargin(w, h);
    const tableTopY = artRect.y + artRect.height * ROOM_ART.tableTopYFrac;
    const tableCenterX = artRect.x + artRect.width * ROOM_ART.tableCenterXFrac;
    const maxW = artRect.width * ROOM_ART.tableWidthFrac * TANK_ON_TABLE_FRAC;
    // Whatever headroom there is between the top of the room and the table it stands on.
    const maxH = (tableTopY - artRect.y) * TANK_FIT_FRAC;
    const scale = Math.min(maxW / w, maxH / h, 1);
    tankSlot.scale.set(scale);
    tankSlot.position.set(tableCenterX - (marginX + w / 2) * scale, tableTopY - (marginY + h) * scale);

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

  /** Art-level (not tank-local) - `predator.xFrac` is a fraction of the room artwork's own width,
   *  standing on the painted table beside the glass rather than inside the water (see PredatorEvent's
   *  own doc comment in types.ts for why). */
  function drawPredator(engine: TankEngine): void {
    const predator = engine.predator;
    if (!predator) {
      predatorContainer.visible = false;
      predatorEmote.visible = false;
      return;
    }
    predatorContainer.visible = true;
    // Once it has the fish there is nothing left to scare it off (see scarePredator), so the
    // pointer stops offering - a cursor that still says "click me" over a cat you cannot affect
    // reads as the tap being broken rather than as being too late.
    const scareable = predator.phase !== 'feast' && predator.phase !== 'flee';
    predatorContainer.eventMode = scareable ? 'static' : 'none';
    predatorContainer.cursor = scareable ? 'pointer' : 'default';
    if (predator.variant !== lastPredatorVariant) {
      lastPredatorVariant = predator.variant;
      drawCatShape(predatorBody);
    }
    // The pose for whichever stage the raid has reached, animated; the drawn shape is what a library
    // without the artwork still gets, so the event is never invisible.
    const onFloor = FLOOR_PHASES.has(predator.phase);
    const headY = placeCastMember(
      predatorSprite,
      castSprite(catSpriteName(predator.variant, PHASE_POSE[predator.phase])),
      0,
      0,
      onFloor ? CAT_WIDTH_FRAC : CAT_RAID_WIDTH_FRAC,
      true,
    );
    // placeCastMember positions in the artwork's coordinates; inside predatorContainer the pose
    // belongs at the container's own origin, which the container then moves to the predator's spot.
    if (headY !== null) predatorSprite.position.set(0, 0);
    predatorBody.visible = headY === null;
    // The cat art is drawn facing right, so a leftward walk is the same sprite flipped. Flipping the
    // sprite rather than the container leaves the countdown bar and the tap target unmirrored.
    predatorSprite.scale.x = Math.abs(predatorSprite.scale.x) * (predator.facingLeft ? -1 : 1);
    // Tap target: the cat's own drawn pixels plus a margin, in the container's local space. The
    // pose sits with its content's bottom-centre on the container origin (see placeCastMember), so
    // the box runs half a width either side of it and a full height up from it.
    if (headY === null) {
      predatorContainer.hitArea = PREDATOR_FALLBACK_TAP;
    } else {
      const drawnWidth = artRect.width * (onFloor ? CAT_WIDTH_FRAC : CAT_RAID_WIDTH_FRAC);
      const drawnHeight = artRect.y - headY;
      predatorContainer.hitArea = new Rectangle(
        -drawnWidth / 2 - PREDATOR_TAP_PADDING,
        -drawnHeight - PREDATOR_TAP_PADDING,
        drawnWidth + PREDATOR_TAP_PADDING * 2,
        drawnHeight + PREDATOR_TAP_PADDING * 2,
      );
    }
    // On the floorboards while it is still crossing the room, up on the table once it is beside the
    // glass - the same two surfaces the sleeping cats and the tank itself stand on.
    const surfaceYFrac = onFloor ? ROOM_ART.floorTopYFrac : ROOM_ART.tableTopYFrac;
    const raidY = artRect.y + artRect.height * surfaceYFrac - (onFloor ? 0 : PREDATOR_FLOOR_GAP);
    predatorContainer.position.set(artRect.x + artRect.width * predator.xFrac, raidY);

    // placeCastMember measured the pose against a bottom of artRect.y (it was called with yFrac 0,
    // since the pose is positioned by its container), so that is what the head height is relative
    // to - the bubble then goes above wherever the container actually put the cat.
    if (headY === null) {
      predatorEmote.visible = false;
    } else {
      placeEmote(predatorEmote, PHASE_EMOTE[predator.phase], predator.xFrac, raidY - (artRect.y - headY));
    }

    // Only the pounce runs a deadline, so it is the only phase that shows a bar. Drawing one during
    // the approach or the stalk would claim the fish was already in danger, and one during the flee
    // or the feast would be counting down to nothing at all.
    predatorTimerBar.visible = predator.phase === 'pounce';
    if (!predatorTimerBar.visible) return;
    const totalMs = Math.max(1, predator.expiresAt - predator.phaseStartedAt);
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
    fitRoomBackground(engine, roomWidth, roomHeight);
    fitTankSlot(engine);
    tankScene.render(engine);
    drawResidents(engine);
    drawCleanlinessBar(engine);
    drawPredator(engine);
  }

  function destroy(): void {
    tankScene.destroy();
    // tankScene.destroy() only tears down its own sceneRoot (removing itself from tankSlot as a side
    // effect) - tapHitArea/scrubBrush are tankSlot's own direct children, torn down here instead.
    tankSlot.destroy({ children: true });
    stage.removeChildren();
    background.destroy();
    floor.destroy();
    roomBackdrop.destroy();
    for (const resident of catResidents) resident.destroy();
    residentEmote.destroy();
    predatorEmote.destroy();
    cleanlinessBar.destroy();
    predatorContainer.destroy({ children: true });
  }

  return { render, setArmedTool, destroy };
}
