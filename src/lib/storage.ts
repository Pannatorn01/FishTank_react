import type { Frame, Instance, Sprite } from './types';

const KEY_SPRITES = 'fishtank.sprites.v1';
const KEY_INSTANCES = 'fishtank.instances.v1';
const KEY_SAVED_COLORS = 'fishtank.savedColors.v1';
const KEY_PALETTE_COLORS = 'fishtank.paletteColors.v1';

export const DEFAULT_GRID_SIZE = 16;
export const GRID_SIZES = [8, 16, 24, 32];

export function uid(prefix?: string): string {
  return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

export function loadSprites(): Sprite[] | null {
  try {
    const raw = localStorage.getItem(KEY_SPRITES);
    return raw ? JSON.parse(raw) : null;
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

export function emptyFrame(size: number): Frame {
  return new Array(size * size).fill(null);
}

export function resampleFrame(frame: Frame, oldSize: number, newSize: number): Frame {
  if (oldSize === newSize) return frame.slice();
  const out = emptyFrame(newSize);
  for (let y = 0; y < newSize; y++) {
    const srcY = Math.min(oldSize - 1, Math.floor((y / newSize) * oldSize));
    for (let x = 0; x < newSize; x++) {
      const srcX = Math.min(oldSize - 1, Math.floor((x / newSize) * oldSize));
      out[y * newSize + x] = frame[srcY * oldSize + srcX];
    }
  }
  return out;
}

function setPixel(frame: Frame, size: number, x: number, y: number, color: string): void {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  frame[y * size + x] = color;
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
  const frame = emptyFrame(size);
  const cx = 10;
  const cy = 8;
  const rx = 4.5;
  const ry = 3.5;
  const tailY = 8 + tailPhase;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (inEllipse(x, y, cx, cy, rx + 1, ry + 1) || inTriangle(x, y, 1, tailY, 5, tailY - 3, 5, tailY + 3)) {
        setPixel(frame, size, x, y, '#c8501c');
      }
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (inEllipse(x, y, cx, cy, rx, ry) || inTriangle(x, y, 2, tailY, 5, tailY - 2, 5, tailY + 2)) {
        setPixel(frame, size, x, y, '#ff7043');
      }
    }
  }
  for (let x = 0; x < size; x++) {
    for (let y = Math.round(cy); y < size; y++) {
      if (inEllipse(x, y, cx, cy + 1, rx - 1, ry - 1.5)) setPixel(frame, size, x, y, '#ffccbc');
    }
  }
  setPixel(frame, size, 12, 6, '#1a1a1a');
  return frame;
}

function buildPlantFrame(size: number, phase: number): Frame {
  const frame = emptyFrame(size);
  const stems = [4, 8, 12];
  stems.forEach((baseX, si) => {
    for (let y = size - 1; y >= 3; y--) {
      const wave = Math.sin(y * 0.5 + phase + si * 1.3) * 1.4;
      const x = Math.round(baseX + wave);
      setPixel(frame, size, x, y, y % 3 === 0 ? '#66bb6a' : '#2e7d32');
      setPixel(frame, size, x + 1, y, y % 3 === 0 ? '#66bb6a' : '#2e7d32');
    }
  });
  return frame;
}

export function buildDefaultSprites(): Sprite[] {
  return [
    {
      id: uid('sprite'),
      name: 'ปลาทอง (ตัวอย่าง)',
      type: 'fish',
      size: DEFAULT_GRID_SIZE,
      frames: [buildFishFrame(DEFAULT_GRID_SIZE, -2), buildFishFrame(DEFAULT_GRID_SIZE, 2)],
    },
    {
      id: uid('sprite'),
      name: 'สาหร่าย (ตัวอย่าง)',
      type: 'object',
      size: DEFAULT_GRID_SIZE,
      frames: [buildPlantFrame(DEFAULT_GRID_SIZE, 0), buildPlantFrame(DEFAULT_GRID_SIZE, Math.PI / 2)],
    },
  ];
}
