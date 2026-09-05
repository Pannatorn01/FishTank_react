import type { Frame } from './types';

/** Longer edge (in cells) a freshly-uploaded photo is downsampled to by default - chunky enough to
 *  read as pixel art once the tank/editor display it with image-rendering: pixelated (see
 *  .pixelated in index.css), not so fine it looks like a blurry photo with square edges. Still
 *  clamped against the caller's own max grid size (see pixelateImageFile) for extreme aspect ratios
 *  or a caller with a smaller cap. */
const DEFAULT_PIXELATE_LONG_EDGE = 128;

/** Below this alpha (0-255), a source pixel becomes a fully transparent (null) cell rather than an
 *  opaque one - this app's sprite colors are plain #rrggbb with no per-pixel alpha (see
 *  pixelMath.ts's rgbToHex), so a partially-transparent source pixel has to resolve one way or the
 *  other rather than carrying its own alpha through. */
const ALPHA_CUTOFF = 128;

function loadImageFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not load image'));
    };
    img.src = url;
  });
}

/**
 * Downsamples an uploaded photo into a Frame (a flat per-cell #rrggbb-or-null array) sized to fit a
 * pixel-art grid, aspect ratio preserved. The browser's own smooth (bilinear) shrink in drawImage
 * does the "averaging" that makes a downsized photo read as chunky pixel art once the caller
 * displays it at cellPx scale with image-rendering: pixelated - no bespoke pixelation algorithm
 * needed, just draw small and let the display upscale it blocky.
 */
export async function pixelateImageFile(
  file: File,
  maxWidth: number,
  maxHeight: number
): Promise<{ width: number; height: number; frame: Frame }> {
  const img = await loadImageFile(file);
  const longEdge = Math.min(DEFAULT_PIXELATE_LONG_EDGE, Math.max(maxWidth, maxHeight));
  const scale = longEdge / Math.max(img.naturalWidth, img.naturalHeight);
  const width = Math.max(1, Math.min(maxWidth, Math.round(img.naturalWidth * scale)));
  const height = Math.max(1, Math.min(maxHeight, Math.round(img.naturalHeight * scale)));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);

  const frame: Frame = new Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const a = data[i * 4 + 3];
    if (a < ALPHA_CUTOFF) {
      frame[i] = null;
      continue;
    }
    const r = data[i * 4].toString(16).padStart(2, '0');
    const g = data[i * 4 + 1].toString(16).padStart(2, '0');
    const b = data[i * 4 + 2].toString(16).padStart(2, '0');
    frame[i] = `#${r}${g}${b}`;
  }
  return { width, height, frame };
}
