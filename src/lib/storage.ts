import type { BackgroundTransform, CanvasBackground, Frame, Instance, Layer, RoomInstance, Sprite, TankGroup, TankShape, UiTheme } from './types';

const KEY_SPRITES = 'fishtank.sprites.v1';
const KEY_INSTANCES = 'fishtank.instances.v1';
const KEY_GROUPS = 'fishtank.groups.v1';
const KEY_ROOM_INSTANCES = 'fishtank.roomInstances.v1';
const KEY_TANK_SIZE = 'fishtank.tankSize.v1';
const KEY_TANK_SHAPE = 'fishtank.tankShape.v1';
export const TANK_SHAPES: TankShape[] = ['rectangle', 'rounded', 'oval'];
/** Which 'background'-type Sprite (drawn in the pixel editor, see SpriteType) is painted behind the
 *  fish instead of the default gradient - null means the default gradient. */
const KEY_TANK_BACKGROUND_SPRITE_ID = 'fishtank.tankBackgroundSpriteId.v1';
/** Free-transform (move/scale/rotate) placement of the background sprite - see BackgroundTransform. */
const KEY_TANK_BACKGROUND_TRANSFORM = 'fishtank.tankBackgroundTransform.v2';
const KEY_SAVED_COLORS = 'fishtank.savedColors.v1';
const KEY_BRUSH_SIZES = 'fishtank.brushSizes.v1';
const KEY_PALETTE_COLORS = 'fishtank.paletteColors.v1';
const KEY_CANVAS_BG = 'fishtank.canvasBackground.v1';
const CANVAS_BACKGROUNDS: CanvasBackground[] = ['checker-dark', 'checker-light', 'white', 'black', 'gray'];
const KEY_UI_THEME = 'fishtank.uiTheme.v1';
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
/** Ceiling for a 'background'-type sprite's custom canvas size specifically - much higher than
 *  MAX_GRID_SIZE, matching useTank.ts's TANK_SIZE_MAX (the largest the tank itself can be), since a
 *  background gets stretched to fill the tank and artists sometimes want to paint it at up to that
 *  resolution directly rather than working small and accepting the upscale blur/blockiness. Kept as
 *  its own literal (not imported from useTank.ts) so lib/storage.ts doesn't take a dependency on a
 *  hook. */
export const MAX_BACKGROUND_GRID_SIZE = { width: 1400, height: 900 };
/** Floor for a 'background'-type sprite's canvas size specifically - much higher than MIN_GRID_SIZE,
 *  since a background stretched to fill the tank from a tiny canvas would look blocky at any zoom level
 *  a player would actually view the tank at, unlike a small fish/object sprite (also meant to be seen
 *  small). Enforced both in the size UI and inside setGridSize itself (see usePixelEditor.ts) so it
 *  can't be bypassed by a resize after switching a sprite's type to 'background'. */
export const MIN_BACKGROUND_GRID_SIZE = 300;
export const LAYER_LIMIT = 12;
export const DEFAULT_FRAME_MS = 350;
export const MIN_FRAME_FPS = 1;
export const MAX_FRAME_FPS = 20;

export function uid(prefix?: string): string {
  return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

export function makeLayer(cells: Frame, name = 'Layer 1'): Layer {
  return { id: uid('layer'), name, visible: true, opacity: 1, cells };
}

function isLegacyFrame(frame: unknown): frame is Frame {
  return Array.isArray(frame) && frame.every((c) => c === null || typeof c === 'string');
}

/**
 * Migrates sprites saved before non-square grids and before layers: backfills width/height from
 * the old single `size` field, and wraps a pre-layers frame (a flat color array) in a single layer.
 */
export function normalizeSprite(sprite: Sprite): Sprite {
  const legacy = sprite as unknown as { size?: number; frames: unknown[] };
  const width = sprite.width || legacy.size || DEFAULT_GRID_SIZE;
  const height = sprite.height || legacy.size || DEFAULT_GRID_SIZE;
  const frames = legacy.frames.map((frame) => (isLegacyFrame(frame) ? [makeLayer(frame)] : (frame as Layer[])));
  return { ...sprite, width, height, frames, frameMs: sprite.frameMs || DEFAULT_FRAME_MS };
}

export function loadSprites(): Sprite[] | null {
  try {
    const raw = localStorage.getItem(KEY_SPRITES);
    if (!raw) return null;
    const parsed: Sprite[] = JSON.parse(raw);
    return parsed.map(normalizeSprite);
  } catch (e) {
    console.warn('loadSprites failed', e);
    return null;
  }
}

export function saveSprites(sprites: Sprite[]): void {
  localStorage.setItem(KEY_SPRITES, JSON.stringify(sprites));
}

export function loadInstances(): Instance[] {
  try {
    const raw = localStorage.getItem(KEY_INSTANCES);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.warn('loadInstances failed', e);
    return [];
  }
}

export function saveInstances(instances: Instance[]): void {
  localStorage.setItem(KEY_INSTANCES, JSON.stringify(instances));
}

export function loadGroups(): TankGroup[] {
  try {
    const raw = localStorage.getItem(KEY_GROUPS);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.warn('loadGroups failed', e);
    return [];
  }
}

export function saveGroups(groups: TankGroup[]): void {
  localStorage.setItem(KEY_GROUPS, JSON.stringify(groups));
}

export function loadRoomInstances(): RoomInstance[] {
  try {
    const raw = localStorage.getItem(KEY_ROOM_INSTANCES);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.warn('loadRoomInstances failed', e);
    return [];
  }
}

export function saveRoomInstances(roomInstances: RoomInstance[]): void {
  localStorage.setItem(KEY_ROOM_INSTANCES, JSON.stringify(roomInstances));
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
  else localStorage.setItem(KEY_TANK_SIZE, JSON.stringify(size));
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
  localStorage.setItem(KEY_TANK_SHAPE, shape);
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
  localStorage.setItem(key, String(value));
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
  if (id) localStorage.setItem(KEY_TANK_BACKGROUND_SPRITE_ID, id);
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
  localStorage.setItem(KEY_TANK_BACKGROUND_TRANSFORM, JSON.stringify(transform));
}

export function loadSavedColors(): string[] {
  try {
    const raw = localStorage.getItem(KEY_SAVED_COLORS);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.warn('loadSavedColors failed', e);
    return [];
  }
}

export function saveSavedColors(colors: string[]): void {
  localStorage.setItem(KEY_SAVED_COLORS, JSON.stringify(colors));
}

/** Brush size remembered per brush-like tool (pen/eraser/spray each paint a different kind of stroke,
 *  so a size picked for one shouldn't silently apply to the others). Keyed loosely by tool name rather
 *  than a fixed union so a future brush-like tool can start persisting its size without a migration. */
export function loadBrushSizes(): Record<string, number> {
  try {
    const raw = localStorage.getItem(KEY_BRUSH_SIZES);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.warn('loadBrushSizes failed', e);
    return {};
  }
}

export function saveBrushSizes(sizes: Record<string, number>): void {
  localStorage.setItem(KEY_BRUSH_SIZES, JSON.stringify(sizes));
}

export function loadPaletteColors(): string[] | null {
  try {
    const raw = localStorage.getItem(KEY_PALETTE_COLORS);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.warn('loadPaletteColors failed', e);
    return null;
  }
}

export function savePaletteColors(colors: string[]): void {
  localStorage.setItem(KEY_PALETTE_COLORS, JSON.stringify(colors));
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
  localStorage.setItem(KEY_CANVAS_BG, bg);
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
  localStorage.setItem(KEY_UI_THEME, theme);
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
