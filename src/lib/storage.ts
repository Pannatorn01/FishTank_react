import type {
  BackgroundTransform,
  CanvasBackground,
  Frame,
  Instance,
  Layer,
  OnionColorMode,
  OnionSettings,
  RecordMeta,
  ResizeAnchor,
  RoomInstance,
  Sprite,
  TankGroup,
  TankShape,
  UiTheme,
} from './types';
import { decodeFrame, encodeFrame, isRleFrame, type RleFrame } from './pixelCodec';

const KEY_SPRITES = 'fishtank.sprites.v1';
const KEY_INSTANCES = 'fishtank.instances.v1';
const KEY_GROUPS = 'fishtank.groups.v1';
const KEY_ROOM_INSTANCES = 'fishtank.roomInstances.v1';
const KEY_TANK_SIZE = 'fishtank.tankSize.v1';
const KEY_TANK_LAST_TICK = 'fishtank.tankLastTick.v1';
const KEY_TANK_WATER_LEVEL = 'fishtank.tankWaterLevel.v1';
const KEY_TANK_ALGAE = 'fishtank.tankAlgae.v1';
const KEY_TANK_SHAPE = 'fishtank.tankShape.v1';
export const TANK_SHAPES: TankShape[] = ['rectangle', 'rounded', 'oval'];
/** Which 'background'-type Sprite (drawn in the pixel editor, see SpriteType) is painted behind the
 *  fish instead of the default gradient - null means the default gradient. */
const KEY_TANK_BACKGROUND_SPRITE_ID = 'fishtank.tankBackgroundSpriteId.v1';
/** Free-transform (move/scale/rotate) placement of the background sprite - see BackgroundTransform. */
const KEY_TANK_BACKGROUND_TRANSFORM = 'fishtank.tankBackgroundTransform.v2';
const KEY_SAVED_COLORS = 'fishtank.savedColors.v1';
/** Subset of KEY_SAVED_COLORS a user has pinned (see ColorPalette.tsx) - a separate key rather than a
 *  shape change to the existing string[] savedColors array, so no migration is needed: an empty/missing
 *  list here just means "nothing pinned yet", which is exactly right for data saved before this feature
 *  existed. */
const KEY_PINNED_COLORS = 'fishtank.pinnedColors.v1';
const KEY_BRUSH_SIZES = 'fishtank.brushSizes.v1';
const KEY_PALETTE_COLORS = 'fishtank.paletteColors.v1';
const KEY_CANVAS_BG = 'fishtank.canvasBackground.v1';
const CANVAS_BACKGROUNDS: CanvasBackground[] = ['checker-dark', 'checker-light', 'white', 'black', 'gray'];
const KEY_UI_THEME = 'fishtank.uiTheme.v1';
/** Onion-skin preferences (see OnionSettings) - an editor preference like the canvas background, not
 *  part of any sprite, so it's its own key rather than anything the sprite format has to migrate. */
const KEY_ONION = 'fishtank.onionSkin.v1';
export const UI_THEMES: UiTheme[] = [
  'cottonCandy',
  'watermelonCandy',
  'caramel',
  'lemonCake',
  'matcha',
  'blueberryMuffin',
  'ube',
  'blackSesame',
  'vanilla',
];

export const DEFAULT_GRID_SIZE = 16;
export const GRID_SIZES = [8, 16, 24, 32];
export const MIN_GRID_SIZE = 4;
export const MAX_GRID_SIZE = 64;
/** Ceiling for a 'background'-type sprite's custom canvas size specifically - a quarter of
 *  useTank.ts's TANK_SIZE_MAX (the largest the tank itself can be), because drawBackground() paints
 *  it back out at DISPLAY_SCALE (4x), same as every other sprite kind. Used to be a straight 1:1 with
 *  TANK_SIZE_MAX so artists could paint at native tank resolution, but that meant a full-size
 *  background got DISPLAY_SCALE'd on top of already being canvas-sized - a cache many times larger
 *  than the tank itself, repainted in full on every drag during resize/scale. Kept as its own literal
 *  (not imported from useTank.ts) so lib/storage.ts doesn't take a dependency on a hook. */
export const MAX_BACKGROUND_GRID_SIZE = { width: 350, height: 225 };
/** Floor for a 'background'-type sprite's canvas size specifically - still higher than MIN_GRID_SIZE
 *  so a background stretched to fill the tank from a tiny canvas doesn't look too blocky, but capped
 *  below MAX_BACKGROUND_GRID_SIZE.height (225) now that the ceiling itself is much smaller. Enforced
 *  both in the size UI and inside setGridSize itself (see usePixelEditor.ts) so it can't be bypassed
 *  by a resize after switching a sprite's type to 'background'. */
export const MIN_BACKGROUND_GRID_SIZE = 150;
export const LAYER_LIMIT = 12;
export const DEFAULT_FRAME_MS = 350;
export const MIN_FRAME_FPS = 1;
export const MAX_FRAME_FPS = 20;

/** Prefix of the per-panel collapse flags written straight to localStorage by EditorDock.tsx - one key
 *  per panel id, so they can only be enumerated by prefix, not listed like the fixed keys above. Kept
 *  here (not in EditorDock) so downloadDataBackup()/resetAllData() can see them: a backup that silently
 *  skips them, or a reset that leaves a broken layout behind, is exactly the failure those two exist to
 *  prevent. */
export const KEY_SIDE_PANEL_COLLAPSED_PREFIX = 'fishtank.sidePanel.collapsed.';
/** Written by useEditorLayout.ts / useUiScale.ts directly (they own the shape, storage.ts only needs to
 *  know the keys exist so backup/reset cover them). */
export const KEY_EDITOR_LAYOUT = 'fishtank.editorLayout.v1';
export const KEY_UI_SCALE = 'fishtank.uiScale.v1';

/**
 * Thrown by every write in this module when the browser refuses to store more - separated from a
 * generic failure so callers can say "your storage is full" (actionable: delete a sprite, export a
 * backup) rather than a bare "save failed". See docs/STORAGE_DB_MIGRATION_PLAN.md P0-1.
 */
export class StorageQuotaError extends Error {
  readonly key: string;
  readonly size: number;
  constructor(key: string, size: number) {
    super(`localStorage quota exceeded writing ${key} (${size} chars)`);
    this.name = 'StorageQuotaError';
    this.key = key;
    this.size = size;
  }
}

/** Browsers disagree on how a full store is reported: name, legacy code, and Firefox's own name are all
 *  in the wild, so all three are treated as "full". */
function isQuotaError(e: unknown): boolean {
  if (!(e instanceof DOMException)) return false;
  return (
    e.name === 'QuotaExceededError' ||
    e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    e.code === 22 ||
    e.code === 1014
  );
}

/** The single write path for this module - every save*() goes through it so a full store surfaces as a
 *  StorageQuotaError instead of a raw DOMException. Still throws (callers decide how to recover, and
 *  several of them roll back in-memory state on failure); it only classifies. */
function writeKey(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    if (isQuotaError(e)) throw new StorageQuotaError(key, value.length);
    throw e;
  }
}

/**
 * Rough "how full is the store" reading for the warning banner - counts only this app's own keys (other
 * origins share nothing, but other scripts on this origin could) and assumes the common ~5MB budget,
 * counting UTF-16 code units as 2 bytes. Deliberately an estimate: browsers expose no real quota API
 * for localStorage, so this is for warning the user early, never for gating a write.
 */
export const STORAGE_BUDGET_BYTES = 5 * 1024 * 1024;

export function estimateUsage(): { bytes: number; percent: number } {
  let chars = 0;
  try {
    for (const key of allOwnedKeys()) {
      const value = localStorage.getItem(key);
      if (value !== null) chars += key.length + value.length;
    }
  } catch (e) {
    console.warn('estimateUsage failed', e);
  }
  const bytes = chars * 2;
  return { bytes, percent: Math.min(100, (bytes / STORAGE_BUDGET_BYTES) * 100) };
}

/** Meta for a record being created right now (see RecordMeta in types.ts). `rev` stays 0 until a
 *  server has accepted it - there is no server yet, so it is 0 everywhere today. */
export function newRecordMeta(): RecordMeta {
  return { updatedAt: Date.now(), deletedAt: 0, rev: 0 };
}

/** Backfills RecordMeta onto a record saved before those fields existed - same "migrate on load, never
 *  write until the next real save" convention as normalizeInstance/normalizeRoomInstances. A record with
 *  no recorded edit time is treated as edited now: any other guess (0, or the file's own age) would make
 *  it lose every future merge against a copy on another device, silently discarding real work. */
export function normalizeMeta<T extends Partial<RecordMeta>>(raw: T): T & RecordMeta {
  return {
    ...raw,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
    deletedAt: typeof raw.deletedAt === 'number' ? raw.deletedAt : 0,
    rev: typeof raw.rev === 'number' ? raw.rev : 0,
  };
}

/** Stamps a record as changed now. Called at save time rather than on every mutation: the tank is
 *  saved as one batch (TankEngine.save), so per-field precision would be invented detail. */
export function touchMeta<T extends RecordMeta>(record: T): T {
  return { ...record, updatedAt: Date.now() };
}

export function uid(prefix?: string): string {
  return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

export function makeLayer(cells: Frame, name = 'Layer 1'): Layer {
  return { id: uid('layer'), name, visible: true, opacity: 1, cells };
}

function isLegacyFrame(frame: unknown): frame is Frame {
  return Array.isArray(frame) && frame.every((c) => c === null || typeof c === 'string');
}

/** A layer as written to storage: same thing as a Layer except its cells are run-length encoded (see
 *  pixelCodec.ts). Frames saved by an older build are still plain arrays, so both are read. */
type StoredLayer = Omit<Layer, 'cells'> & { cells: Frame | RleFrame };
type StoredSprite = Omit<Sprite, 'frames'> & { frames: StoredLayer[][] };

/** Storage shape -> memory shape. Nothing above this file ever sees an encoded frame. */
function decodeLayer(layer: StoredLayer): Layer {
  return { ...layer, cells: isRleFrame(layer.cells) ? decodeFrame(layer.cells) : layer.cells };
}

/** Memory shape -> storage shape. */
function encodeSprite(sprite: Sprite): StoredSprite {
  return {
    ...sprite,
    frames: sprite.frames.map((layers) => layers.map((layer) => ({ ...layer, cells: encodeFrame(layer.cells) }))),
  };
}

/**
 * Migrates sprites saved before non-square grids and before layers: backfills width/height from
 * the old single `size` field, and wraps a pre-layers frame (a flat color array) in a single layer.
 * Also decodes run-length-encoded frames (the current storage format) back into the flat arrays the
 * editor and the renderers work on.
 */
export function normalizeSprite(sprite: Sprite): Sprite {
  const legacy = sprite as unknown as { size?: number; frames: unknown[] };
  const width = sprite.width || legacy.size || DEFAULT_GRID_SIZE;
  const height = sprite.height || legacy.size || DEFAULT_GRID_SIZE;
  const frames = legacy.frames.map((frame) =>
    isLegacyFrame(frame) ? [makeLayer(frame)] : (frame as StoredLayer[]).map(decodeLayer)
  );
  return {
    ...normalizeMeta(sprite),
    // A sprite saved before ids were mandatory (or one hand-edited to drop it) still has to be
    // addressable - give it one now rather than letting a null id reach code that assumes a string.
    id: sprite.id || uid('sprite'),
    width,
    height,
    frames,
    frameMs: sprite.frameMs || DEFAULT_FRAME_MS,
  };
}

/**
 * Guards against a sprite that parsed as valid JSON but isn't shaped like a Sprite at all - a hand-
 * edited localStorage value, a future format loaded by an older build, or (see the bresenhamLine fix
 * in pixelMath.ts) any other bug that could have written `width`/`height` as `NaN` before this existed.
 * Without this, a single malformed sprite reaching the engine unchecked used to be able to crash the
 * whole app on render with no recovery but manually clearing localStorage - see
 * docs/EDITOR_IMPROVEMENTS.md #2. Deliberately loose about *content* (a sprite with the wrong `type`
 * string, say, is left to whatever already handles that) and strict only about the shape every other
 * function in this file and in usePixelEditor.ts assumes without checking: finite positive integer
 * dimensions, and every layer's `cells` array being exactly `width * height` long.
 */
function isValidSprite(sprite: unknown): sprite is Sprite {
  if (!sprite || typeof sprite !== 'object') return false;
  const s = sprite as Sprite;
  if (typeof s.name !== 'string') return false;
  if (!Number.isFinite(s.width) || !Number.isFinite(s.height) || s.width <= 0 || s.height <= 0) return false;
  if (!Array.isArray(s.frames) || s.frames.length === 0) return false;
  const cellCount = s.width * s.height;
  return s.frames.every(
    (layers) =>
      Array.isArray(layers) &&
      layers.length > 0 &&
      layers.every((layer) => layer && Array.isArray(layer.cells) && layer.cells.length === cellCount)
  );
}

export function loadSprites(): Sprite[] | null {
  try {
    const raw = localStorage.getItem(KEY_SPRITES);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const normalized = parsed.map(normalizeSprite);
    // Tombstones are storage's business, not the editor's - a deleted sprite has no frames left and
    // would only fail isValidSprite() below and be reported as "malformed".
    const live = normalized.filter((s) => s.deletedAt === 0);
    const valid = live.filter(isValidSprite);
    if (valid.length < live.length) {
      console.warn(`loadSprites: dropped ${live.length - valid.length} malformed sprite(s)`);
    }
    // Some sprites survived - still better than throwing every saved sprite away; only fall back to
    // null (triggering the default sprite set) when literally nothing usable was left.
    return valid.length > 0 ? valid : null;
  } catch (e) {
    console.warn('loadSprites failed', e);
    return null;
  }
}

/**
 * Every sprite record as stored, tombstones included. Only the persistence layer wants this view - the
 * app itself asks loadSprites() for the sprites a user can actually see.
 */
function loadSpriteRecords(): Sprite[] {
  try {
    const raw = localStorage.getItem(KEY_SPRITES);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(normalizeSprite) : [];
  } catch (e) {
    console.warn('loadSpriteRecords failed', e);
    return [];
  }
}

/**
 * What a deleted sprite leaves behind: its identity and the moment it died, with the pixels dropped.
 * Keeping the frames would mean a user could never actually reclaim space by deleting work, which is
 * the whole point of the delete button today; keeping the record means a future server can tell a
 * deletion apart from a device that simply has not uploaded that sprite yet (see RecordMeta).
 */
function tombstoneFor(sprite: Sprite, now: number): Sprite {
  return { ...sprite, frames: [], updatedAt: now, deletedAt: now };
}

/**
 * Writes the library. Callers pass the *live* sprites only (that is all the editor holds); the
 * tombstones already in storage are carried across here, so nothing has to remember they exist.
 * A sprite that reappears in `sprites` after being deleted - a re-import of the same id, say - loses
 * its tombstone, which is correct: it is alive again.
 */
export function saveSprites(sprites: Sprite[]): void {
  const now = Date.now();
  const alive = new Set(sprites.map((s) => s.id));
  const previous = loadSpriteRecords();
  const carriedTombstones = previous.filter((s) => s.deletedAt > 0 && !alive.has(s.id));
  const removed = previous
    .filter((s) => s.deletedAt === 0 && !alive.has(s.id))
    .map((s) => tombstoneFor(s, now));
  const records = [...sprites, ...carriedTombstones, ...removed];
  writeKey(KEY_SPRITES, JSON.stringify(records.map(encodeSprite)));
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Natural-lifespan range from docs/PIXI_MIGRATION_PLAN.md §9.1 - long enough that a fish born from
 *  breeding (3-day maturation, once that's built in a later P5 item) has time to grow up, short
 *  enough a birth-to-death cycle is visible within a month rather than requiring a year of real time. */
const FISH_LIFESPAN_MIN_DAYS = 18;
const FISH_LIFESPAN_MAX_DAYS = 30;

/** Rolled once per fish at birth (see `addInstance` in useTank.ts) and stored on the instance itself,
 *  not recomputed later - a fish's lifespan is fixed at how long it happened to roll, not re-randomized
 *  on every load. */
export function randomFishLifespanMs(): number {
  const days = FISH_LIFESPAN_MIN_DAYS + Math.random() * (FISH_LIFESPAN_MAX_DAYS - FISH_LIFESPAN_MIN_DAYS);
  return days * DAY_MS;
}

/** Backfills the P5 lifecycle fields (`bornAt`/`lifespanMs`/`dead`/`diedAt`, added after this record
 *  shape shipped) onto an instance saved by an older build that predates them - same "migrate on load,
 *  never write until the next real save" convention as normalizeRoomInstances. A pre-existing fish that
 *  never had a birth time recorded starts its clock now (treated as newly "born" on first load under
 *  the new build) rather than being treated as already dead or requiring guesswork about its true age. */
function normalizeInstance(raw: Instance): Instance {
  return {
    ...normalizeMeta(raw),
    bornAt: typeof raw.bornAt === 'number' ? raw.bornAt : Date.now(),
    lifespanMs: typeof raw.lifespanMs === 'number' ? raw.lifespanMs : randomFishLifespanMs(),
    dead: typeof raw.dead === 'boolean' ? raw.dead : false,
    diedAt: typeof raw.diedAt === 'number' ? raw.diedAt : 0,
    hunger: typeof raw.hunger === 'number' ? raw.hunger : 1,
    starvingSince: typeof raw.starvingSince === 'number' ? raw.starvingSince : 0,
  };
}

export function loadInstances(): Instance[] {
  try {
    const raw = localStorage.getItem(KEY_INSTANCES);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(normalizeInstance) : [];
  } catch (e) {
    console.warn('loadInstances failed', e);
    return [];
  }
}

export function saveInstances(instances: Instance[]): void {
  writeKey(KEY_INSTANCES, JSON.stringify(instances));
}

export function loadGroups(): TankGroup[] {
  try {
    const raw = localStorage.getItem(KEY_GROUPS);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map((g) => normalizeMeta(g as TankGroup)) : [];
  } catch (e) {
    console.warn('loadGroups failed', e);
    return [];
  }
}

export function saveGroups(groups: TankGroup[]): void {
  writeKey(KEY_GROUPS, JSON.stringify(groups));
}

/** Fraction of the tank's own width/height added as "room" space on every side, for room decor to
 *  sit in - see RoomInstance's own doc comment (types.ts) and normalizeRoomInstances below. Kept
 *  here (not useTank.ts) since the migration needs the exact same value the live app uses to place
 *  new room decor, and this is the one file both tankScene.ts's Pixi renderer and useTank.ts already
 *  import from. */
export const ROOM_MARGIN_FRAC = 0.35;

/** The single source of truth for how big the "room" (the space room decor can occupy around the
 *  tank - see RoomInstance's doc comment in types.ts) is, in tank-logical px, given the tank's own
 *  current size. Used by TankEngine's own clampRoomPosition (useTank.ts) to bound where a room item
 *  can be dragged, and by the Pixi renderer (tankScene.ts, TankPixiLayer.tsx) to size and offset the
 *  scene so that same margin is actually visible/paintable - both need the exact same numbers or a
 *  room item could be draggable to a position the renderer then clips off-canvas. */
export function roomSceneMargin(tankWidth: number, tankHeight: number): { marginX: number; marginY: number; sceneWidth: number; sceneHeight: number } {
  const marginX = tankWidth * ROOM_MARGIN_FRAC;
  const marginY = tankHeight * ROOM_MARGIN_FRAC;
  return { marginX, marginY, sceneWidth: tankWidth + marginX * 2, sceneHeight: tankHeight + marginY * 2 };
}

/** Pre-P2 shape (see git history / docs/PIXI_MIGRATION_PLAN.md §7-B) - center position as a fraction
 *  (0..1) of the *browser viewport's* width/height at 100% zoom, with the tank frame centered inside
 *  it. Only ever produced by versions of this app before RoomInstance moved to tank-relative x/y. */
interface LegacyRoomInstance {
  id: string;
  spriteId: string;
  xFrac: number;
  yFrac: number;
  visible?: boolean;
}

function isLegacyRoomInstance(r: unknown): r is LegacyRoomInstance {
  return !!r && typeof r === 'object' && typeof (r as LegacyRoomInstance).xFrac === 'number';
}

/**
 * Migrates whatever loadRoomInstances() returns onto the current RoomInstance shape (tank-relative
 * x/y - see its own doc comment in types.ts), tolerating both a legacy record (xFrac/yFrac) and an
 * already-current one (x/y) in the same array, since a user could have saved before P2 and never
 * touched room decor since.
 *
 * The legacy fraction was of the *browser viewport*, which was never itself saved anywhere - there is
 * no way to reconstruct exactly where a legacy item would have appeared on the specific screen it was
 * placed on. Instead, the fraction is reinterpreted directly over the *new* room rectangle (the tank
 * plus its ROOM_MARGIN_FRAC margin): xFrac=0 -> the room's left edge, xFrac=1 -> its right edge, and
 * so on. This isn't pixel-identical to the old placement (nothing could be, without the original
 * viewport size) but it is deterministic, keeps left-of-center items left-of-center and top items on
 * top, and - the actual bar this needs to clear - always lands the item at a valid, reasonable
 * position rather than off in undefined space or clamped to a corner.
 */
export function normalizeRoomInstances(raw: unknown, tankWidth: number, tankHeight: number): RoomInstance[] {
  if (!Array.isArray(raw)) return [];
  const marginX = tankWidth * ROOM_MARGIN_FRAC;
  const marginY = tankHeight * ROOM_MARGIN_FRAC;
  const roomWidth = tankWidth + marginX * 2;
  const roomHeight = tankHeight + marginY * 2;
  return raw
    .map((r): RoomInstance | null => {
      if (isLegacyRoomInstance(r)) {
        return {
          ...normalizeMeta(r as Partial<RecordMeta>),
          id: r.id,
          spriteId: r.spriteId,
          x: r.xFrac * roomWidth - marginX,
          y: r.yFrac * roomHeight - marginY,
          visible: r.visible ?? true,
        };
      }
      const inst = r as Partial<RoomInstance>;
      if (typeof inst.id !== 'string' || typeof inst.spriteId !== 'string') return null;
      return {
        ...normalizeMeta(inst),
        id: inst.id,
        spriteId: inst.spriteId,
        x: typeof inst.x === 'number' ? inst.x : 0,
        y: typeof inst.y === 'number' ? inst.y : 0,
        visible: inst.visible ?? true,
      };
    })
    .filter((r): r is RoomInstance => r !== null);
}

export function loadRoomInstances(tankWidth: number, tankHeight: number): RoomInstance[] {
  try {
    const raw = localStorage.getItem(KEY_ROOM_INSTANCES);
    return raw ? normalizeRoomInstances(JSON.parse(raw), tankWidth, tankHeight) : [];
  } catch (e) {
    console.warn('loadRoomInstances failed', e);
    return [];
  }
}

export function saveRoomInstances(roomInstances: RoomInstance[]): void {
  writeKey(KEY_ROOM_INSTANCES, JSON.stringify(roomInstances));
}

export function loadTankSize(): { width: number; height: number } | null {
  try {
    const raw = localStorage.getItem(KEY_TANK_SIZE);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.width !== 'number' || typeof parsed?.height !== 'number') return null;
    return parsed;
  } catch (e) {
    console.warn('loadTankSize failed', e);
    return null;
  }
}

export function saveTankSize(size: { width: number; height: number } | null): void {
  if (!size) localStorage.removeItem(KEY_TANK_SIZE);
  else writeKey(KEY_TANK_SIZE, JSON.stringify(size));
}

/** Wall-clock checkpoint for hunger/starvation catch-up (see tickHunger() in useTank.ts) - epoch ms
 *  the care simulation was last resolved up to, refreshed on every save() so a reload only has to
 *  replay the real time the tab was actually closed for. */
export function loadTankLastTick(): number | null {
  try {
    const raw = localStorage.getItem(KEY_TANK_LAST_TICK);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch (e) {
    console.warn('loadTankLastTick failed', e);
    return null;
  }
}

export function saveTankLastTick(ms: number): void {
  writeKey(KEY_TANK_LAST_TICK, String(ms));
}

/** 1 (full) .. 0 (empty) - evaporates over real time (see tickWaterLevel() in useTank.ts), caught up
 *  from the same `fishtank.tankLastTick.v1` checkpoint hunger uses, and restored to 1 by the Life-mode
 *  refill button (P5 §6 item 4). */
export function loadTankWaterLevel(): number | null {
  try {
    const raw = localStorage.getItem(KEY_TANK_WATER_LEVEL);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : null;
  } catch (e) {
    console.warn('loadTankWaterLevel failed', e);
    return null;
  }
}

export function saveTankWaterLevel(level: number): void {
  localStorage.setItem(KEY_TANK_WATER_LEVEL, String(level));
}

/** 0 (spotless) .. 1 (fully covered) - grows over real time (see tickAlgae() in useTank.ts), caught up
 *  from the same checkpoint hunger/water level use, and reduced by scrubbing in Life mode (P5 §6
 *  item 5). */
export function loadTankAlgae(): number | null {
  try {
    const raw = localStorage.getItem(KEY_TANK_ALGAE);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : null;
  } catch (e) {
    console.warn('loadTankAlgae failed', e);
    return null;
  }
}

export function saveTankAlgae(algae: number): void {
  localStorage.setItem(KEY_TANK_ALGAE, String(algae));
}

export function loadTankShape(): TankShape | null {
  try {
    const raw = localStorage.getItem(KEY_TANK_SHAPE);
    return raw && (TANK_SHAPES as string[]).includes(raw) ? (raw as TankShape) : null;
  } catch (e) {
    console.warn('loadTankShape failed', e);
    return null;
  }
}

export function saveTankShape(shape: TankShape): void {
  writeKey(KEY_TANK_SHAPE, shape);
}

export function loadTankShapeParam(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch (e) {
    console.warn('loadTankShapeParam failed', e);
    return null;
  }
}

export function saveTankShapeParam(key: string, value: number): void {
  writeKey(key, String(value));
}

export const KEY_TANK_CORNER_RADIUS_FRAC = 'fishtank.tankCornerRadiusFrac.v1';
export const KEY_TANK_OVAL_TOP_CUT_FRAC = 'fishtank.tankOvalTopCutFrac.v1';

/** null means "use the default gradient water background". */
export function loadTankBackgroundSpriteId(): string | null {
  try {
    return localStorage.getItem(KEY_TANK_BACKGROUND_SPRITE_ID);
  } catch (e) {
    console.warn('loadTankBackgroundSpriteId failed', e);
    return null;
  }
}

export function saveTankBackgroundSpriteId(id: string | null): void {
  if (id) writeKey(KEY_TANK_BACKGROUND_SPRITE_ID, id);
  else localStorage.removeItem(KEY_TANK_BACKGROUND_SPRITE_ID);
}

export function loadTankBackgroundTransform(): BackgroundTransform | null {
  try {
    const raw = localStorage.getItem(KEY_TANK_BACKGROUND_TRANSFORM);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.x !== 'number' ||
      typeof parsed?.y !== 'number' ||
      typeof parsed?.scale !== 'number' ||
      typeof parsed?.rotation !== 'number'
    )
      return null;
    return parsed;
  } catch (e) {
    console.warn('loadTankBackgroundTransform failed', e);
    return null;
  }
}

export function saveTankBackgroundTransform(transform: BackgroundTransform): void {
  writeKey(KEY_TANK_BACKGROUND_TRANSFORM, JSON.stringify(transform));
}

/**
 * The colour lists and brush-size map get the same treatment sprites already had (isValidSprite, see
 * docs/EDITOR_IMPROVEMENTS.md #2): JSON that parses is not JSON that is shaped right. A value of the
 * wrong shape used to flow straight into the engine, and something as ordinary as a corrupted palette
 * key would then be rendered as one swatch per character - enough to hang the app on load, with no way
 * out but clearing storage by hand.
 */
function asStringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((v) => typeof v === 'string') ? value : null;
}

function asNumberRecord(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.every(([, v]) => typeof v === 'number' && Number.isFinite(v))
    ? (value as Record<string, number>)
    : null;
}

export function loadSavedColors(): string[] {
  try {
    const raw = localStorage.getItem(KEY_SAVED_COLORS);
    return raw ? (asStringArray(JSON.parse(raw)) ?? []) : [];
  } catch (e) {
    console.warn('loadSavedColors failed', e);
    return [];
  }
}

export function saveSavedColors(colors: string[]): void {
  writeKey(KEY_SAVED_COLORS, JSON.stringify(colors));
}

export function loadPinnedColors(): string[] {
  try {
    const raw = localStorage.getItem(KEY_PINNED_COLORS);
    return raw ? (asStringArray(JSON.parse(raw)) ?? []) : [];
  } catch (e) {
    console.warn('loadPinnedColors failed', e);
    return [];
  }
}

export function savePinnedColors(colors: string[]): void {
  writeKey(KEY_PINNED_COLORS, JSON.stringify(colors));
}

/** Brush size remembered per brush-like tool (pen/eraser/spray each paint a different kind of stroke,
 *  so a size picked for one shouldn't silently apply to the others). Keyed loosely by tool name rather
 *  than a fixed union so a future brush-like tool can start persisting its size without a migration. */
export function loadBrushSizes(): Record<string, number> {
  try {
    const raw = localStorage.getItem(KEY_BRUSH_SIZES);
    return raw ? (asNumberRecord(JSON.parse(raw)) ?? {}) : {};
  } catch (e) {
    console.warn('loadBrushSizes failed', e);
    return {};
  }
}

export function saveBrushSizes(sizes: Record<string, number>): void {
  writeKey(KEY_BRUSH_SIZES, JSON.stringify(sizes));
}

export function loadPaletteColors(): string[] | null {
  try {
    const raw = localStorage.getItem(KEY_PALETTE_COLORS);
    return raw ? asStringArray(JSON.parse(raw)) : null;
  } catch (e) {
    console.warn('loadPaletteColors failed', e);
    return null;
  }
}

export function savePaletteColors(colors: string[]): void {
  writeKey(KEY_PALETTE_COLORS, JSON.stringify(colors));
}

export function loadCanvasBackground(): CanvasBackground | null {
  try {
    const raw = localStorage.getItem(KEY_CANVAS_BG);
    return raw && CANVAS_BACKGROUNDS.includes(raw as CanvasBackground) ? (raw as CanvasBackground) : null;
  } catch (e) {
    console.warn('loadCanvasBackground failed', e);
    return null;
  }
}

export function saveCanvasBackground(bg: CanvasBackground): void {
  writeKey(KEY_CANVAS_BG, bg);
}

const ONION_COLOR_MODES: OnionColorMode[] = ['tint', 'original'];

/** Returns null (i.e. "use the defaults") for anything missing or out of range rather than trusting
 *  what's in storage - this key is written by a version of the app that may not be the one reading it. */
export function loadOnionSettings(): OnionSettings | null {
  try {
    const raw = localStorage.getItem(KEY_ONION);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OnionSettings>;
    const depth = (v: unknown, fallback: number) =>
      typeof v === 'number' && Number.isFinite(v) ? Math.min(3, Math.max(0, Math.round(v))) : fallback;
    return {
      enabled: parsed.enabled === true,
      before: depth(parsed.before, 1),
      after: depth(parsed.after, 1),
      opacity:
        typeof parsed.opacity === 'number' && Number.isFinite(parsed.opacity)
          ? Math.min(1, Math.max(0.1, parsed.opacity))
          : 0.45,
      colorMode: ONION_COLOR_MODES.includes(parsed.colorMode as OnionColorMode) ? (parsed.colorMode as OnionColorMode) : 'tint',
    };
  } catch (e) {
    console.warn('loadOnionSettings failed', e);
    return null;
  }
}

export function saveOnionSettings(settings: OnionSettings): void {
  writeKey(KEY_ONION, JSON.stringify(settings));
}

export function loadUiTheme(): UiTheme | null {
  try {
    const raw = localStorage.getItem(KEY_UI_THEME);
    return raw && UI_THEMES.includes(raw as UiTheme) ? (raw as UiTheme) : null;
  } catch (e) {
    console.warn('loadUiTheme failed', e);
    return null;
  }
}

export function saveUiTheme(theme: UiTheme): void {
  writeKey(KEY_UI_THEME, theme);
}

export function emptyFrame(width: number, height: number): Frame {
  return new Array(width * height).fill(null);
}

export function resampleFrame(frame: Frame, oldW: number, oldH: number, newW: number, newH: number): Frame {
  if (oldW === newW && oldH === newH) return frame.slice();
  const out = emptyFrame(newW, newH);
  for (let y = 0; y < newH; y++) {
    const srcY = Math.min(oldH - 1, Math.floor((y / newH) * oldH));
    for (let x = 0; x < newW; x++) {
      const srcX = Math.min(oldW - 1, Math.floor((x / newW) * oldW));
      out[y * newW + x] = frame[srcY * oldW + srcX];
    }
  }
  return out;
}

/** Where each 9-point ResizeAnchor sits as a 0..1 fraction across the resize delta - see padFrame. */
export const RESIZE_ANCHOR_FRAC: Record<ResizeAnchor, { x: number; y: number }> = {
  'top-left': { x: 0, y: 0 },
  'top-center': { x: 0.5, y: 0 },
  'top-right': { x: 1, y: 0 },
  'middle-left': { x: 0, y: 0.5 },
  'middle-center': { x: 0.5, y: 0.5 },
  'middle-right': { x: 1, y: 0.5 },
  'bottom-left': { x: 0, y: 1 },
  'bottom-center': { x: 0.5, y: 1 },
  'bottom-right': { x: 1, y: 1 },
};

/**
 * Crop/expand resize: places the old (oldW x oldH) frame's content at (offsetX, offsetY) inside a new
 * (newW x newH) canvas, unlike resampleFrame's stretch - pixels outside the new canvas are dropped,
 * and any newly-added area is left transparent. `offsetX`/`offsetY` are typically derived from
 * RESIZE_ANCHOR_FRAC (see usePixelEditor.ts's setGridSize) or from a content bounding box (see
 * usePixelEditor.ts's trimToContent, which crops with the exact offset needed to drop empty borders).
 */
export function padFrame(frame: Frame, oldW: number, oldH: number, newW: number, newH: number, offsetX: number, offsetY: number): Frame {
  const out = emptyFrame(newW, newH);
  for (let y = 0; y < oldH; y++) {
    const ny = y + offsetY;
    if (ny < 0 || ny >= newH) continue;
    for (let x = 0; x < oldW; x++) {
      const nx = x + offsetX;
      if (nx < 0 || nx >= newW) continue;
      out[ny * newW + nx] = frame[y * oldW + x];
    }
  }
  return out;
}

function setPixel(frame: Frame, width: number, height: number, x: number, y: number, color: string): void {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  frame[y * width + x] = color;
}

function inEllipse(x: number, y: number, cx: number, cy: number, rx: number, ry: number): boolean {
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

function inTriangle(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number
): boolean {
  const sign = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
    (ax - cx) * (by - cy) - (bx - cx) * (ay - cy);
  const d1 = sign(px, py, x1, y1, x2, y2);
  const d2 = sign(px, py, x2, y2, x3, y3);
  const d3 = sign(px, py, x3, y3, x1, y1);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function buildFishFrame(size: number, tailPhase: number): Frame {
  const frame = emptyFrame(size, size);
  const cx = 10;
  const cy = 8;
  const rx = 4.5;
  const ry = 3.5;
  const tailY = 8 + tailPhase;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (inEllipse(x, y, cx, cy, rx + 1, ry + 1) || inTriangle(x, y, 1, tailY, 5, tailY - 3, 5, tailY + 3)) {
        setPixel(frame, size, size, x, y, '#c8501c');
      }
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (inEllipse(x, y, cx, cy, rx, ry) || inTriangle(x, y, 2, tailY, 5, tailY - 2, 5, tailY + 2)) {
        setPixel(frame, size, size, x, y, '#ff7043');
      }
    }
  }
  for (let x = 0; x < size; x++) {
    for (let y = Math.round(cy); y < size; y++) {
      if (inEllipse(x, y, cx, cy + 1, rx - 1, ry - 1.5)) setPixel(frame, size, size, x, y, '#ffccbc');
    }
  }
  setPixel(frame, size, size, 12, 6, '#1a1a1a');
  return frame;
}

function buildPlantFrame(size: number, phase: number): Frame {
  const frame = emptyFrame(size, size);
  const stems = [4, 8, 12];
  stems.forEach((baseX, si) => {
    for (let y = size - 1; y >= 3; y--) {
      const wave = Math.sin(y * 0.5 + phase + si * 1.3) * 1.4;
      const x = Math.round(baseX + wave);
      setPixel(frame, size, size, x, y, y % 3 === 0 ? '#66bb6a' : '#2e7d32');
      setPixel(frame, size, size, x + 1, y, y % 3 === 0 ? '#66bb6a' : '#2e7d32');
    }
  });
  return frame;
}

export function buildDefaultSprites(): Sprite[] {
  return [
    {
      ...newRecordMeta(),
      id: uid('sprite'),
      name: 'Goldfish (sample)',
      type: 'fish',
      width: DEFAULT_GRID_SIZE,
      height: DEFAULT_GRID_SIZE,
      frames: [
        [makeLayer(buildFishFrame(DEFAULT_GRID_SIZE, -2))],
        [makeLayer(buildFishFrame(DEFAULT_GRID_SIZE, 2))],
      ],
      frameMs: DEFAULT_FRAME_MS,
    },
    {
      ...newRecordMeta(),
      id: uid('sprite'),
      name: 'Seaweed (sample)',
      type: 'object',
      width: DEFAULT_GRID_SIZE,
      height: DEFAULT_GRID_SIZE,
      frames: [
        [makeLayer(buildPlantFrame(DEFAULT_GRID_SIZE, 0))],
        [makeLayer(buildPlantFrame(DEFAULT_GRID_SIZE, Math.PI / 2))],
      ],
      frameMs: DEFAULT_FRAME_MS,
    },
  ];
}

/** Every localStorage key this app writes - kept as one list so backup/reset (see below) can't drift
 *  out of sync with a key added elsewhere in this file without updating this too. */
const ALL_STORAGE_KEYS = [
  KEY_EDITOR_LAYOUT,
  KEY_UI_SCALE,
  KEY_SPRITES,
  KEY_INSTANCES,
  KEY_GROUPS,
  KEY_ROOM_INSTANCES,
  KEY_TANK_SIZE,
  KEY_TANK_LAST_TICK,
  KEY_TANK_WATER_LEVEL,
  KEY_TANK_ALGAE,
  KEY_TANK_SHAPE,
  KEY_TANK_BACKGROUND_SPRITE_ID,
  KEY_TANK_BACKGROUND_TRANSFORM,
  KEY_SAVED_COLORS,
  KEY_PINNED_COLORS,
  KEY_BRUSH_SIZES,
  KEY_PALETTE_COLORS,
  KEY_CANVAS_BG,
  KEY_UI_THEME,
  KEY_ONION,
  KEY_TANK_CORNER_RADIUS_FRAC,
  KEY_TANK_OVAL_TOP_CUT_FRAC,
];

/** Every key this app currently owns: the fixed list plus the variable-count per-panel collapse flags,
 *  which only exist once a panel has been collapsed at least once. Both backup and reset need the full
 *  picture, hence one helper rather than two loops that can drift apart. */
function allOwnedKeys(): string[] {
  const keys = [...ALL_STORAGE_KEYS];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(KEY_SIDE_PANEL_COLLAPSED_PREFIX)) keys.push(key);
    }
  } catch (e) {
    console.warn('allOwnedKeys: could not enumerate localStorage', e);
  }
  return keys;
}

/**
 * Bundles every raw localStorage value this app owns into one downloadable JSON file - the "get my
 * work out" escape hatch an ErrorBoundary offers when the app itself can no longer render (see
 * docs/EDITOR_IMPROVEMENTS.md #1). Deliberately reads the *raw* strings, not through loadSprites() et
 * al: if the app is crashing because a loader chokes on the data, this needs to work anyway. Returns
 * false (and does nothing) if there was nothing to back up at all.
 */
export function downloadDataBackup(): boolean {
  const dump: Record<string, string> = {};
  for (const key of allOwnedKeys()) {
    const value = localStorage.getItem(key);
    if (value !== null) dump[key] = value;
  }
  if (Object.keys(dump).length === 0) return false;
  const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pixel-fish-tank-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return true;
}

/** Wipes every key this app owns - the "start over" escape hatch next to downloadDataBackup(), for
 *  when saved data itself is what's broken (see docs/EDITOR_IMPROVEMENTS.md #2). Leaves every other
 *  origin's localStorage untouched (unlike a blanket `localStorage.clear()`), and does not reload the
 *  page itself - the caller decides when. */
export function resetAllData(): void {
  for (const key of allOwnedKeys()) localStorage.removeItem(key);
}
