import type { TankShape } from '@/lib/types';

/**
 * The tank's swim-area silhouette math, factored out as plain data/functions with zero dependency on
 * Canvas2D, Pixi, or the DOM - so it can be unit-tested headless and, more importantly, is no longer
 * duplicated between the two renderers that need it. Before this file existed, useTank.ts's own
 * shapePath() (Canvas2D, builds a Path2D) and tankScene.ts's traceShape() (Pixi, builds a Graphics
 * polygon) each independently re-derived the oval's flat-top-cut trigonometry from scratch, kept in
 * sync only "by eye" (see their old comments) - a real, live drift risk every time either one changed.
 * Both now call ovalFlatTopGeometry() below for the exact same numbers.
 *
 * docs/PIXI_MIGRATION_PLAN.md P3 - part of "รื้อ TankEngine เป็น model / sim / render".
 */

/** Corner-radius slider range for the 'rounded' tank shape, as a fraction of the tank's smaller
 *  dimension - shared by the shape math below and the slider UI (TankCanvas.tsx, re-exported from
 *  useTank.ts so that import site didn't need to change). */
export const ROUNDED_RADIUS_MIN = 0.05;
export const ROUNDED_RADIUS_MAX = 0.5;

/** Top-cut slider range for the 'oval' tank shape, as a fraction of tank height (0 = a full ellipse,
 *  larger values flatten more of the top) - same sharing arrangement as the ROUNDED_RADIUS_* pair. */
export const OVAL_TOP_CUT_MIN = 0;
export const OVAL_TOP_CUT_MAX = 0.45;

/** Corner radius used for the 'rounded' tank shape, in canvas px - scaled off the smaller dimension
 *  so it reads consistently whether the tank is wide or tall. `cornerRadiusFrac` is clamped to
 *  ROUNDED_RADIUS_MIN/MAX here (not by the caller) so every call site - draw-time outline, the
 *  placement/physics clamp, Pixi's mask - agrees on the same effective radius even if some other bug
 *  ever let an out-of-range value slip into storage. */
export function roundedCornerRadius(w: number, h: number, cornerRadiusFrac: number): number {
  const clamped = Math.max(ROUNDED_RADIUS_MIN, Math.min(ROUNDED_RADIUS_MAX, cornerRadiusFrac));
  return Math.min(w, h) * clamped;
}

/** Everything needed to draw or clamp against the 'oval' shape's boundary, with its optional
 *  flat-top cut solved once here rather than by each caller. `hasCut: false` (the cut is negligible
 *  or the tank has no height) means "just draw/use a full ellipse" - every consumer already has to
 *  branch on this, so it's returned explicitly instead of forcing a redundant threshold check on
 *  both `thetaRight`/`thetaLeft` being present. */
export type OvalGeometry =
  | { hasCut: false; cx: number; cy: number; rx: number; ry: number }
  | {
      hasCut: true;
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      /** Where the flat top's two corners meet the ellipse curve, in the ellipse's own parametric
       *  angle (x = cx + rx*cos(theta), y = cy + ry*sin(theta)) - thetaRight in [-π/2, π/2],
       *  thetaLeft = π - thetaRight, sweeping from thetaRight through the bottom (theta = π/2) up to
       *  thetaLeft is the curved part of the boundary; the flat line at y = topCutY from xLeft to
       *  xRight closes it off. */
      thetaRight: number;
      thetaLeft: number;
      topCutY: number;
      xLeft: number;
      xRight: number;
    };

export function ovalFlatTopGeometry(w: number, h: number, ovalTopCutFrac: number): OvalGeometry {
  const cx = w / 2;
  const cy = h / 2;
  const rx = Math.max(0, w / 2);
  const ry = Math.max(0, h / 2);
  const t = Math.max(OVAL_TOP_CUT_MIN, Math.min(OVAL_TOP_CUT_MAX, ovalTopCutFrac));
  if (t <= 0.001 || ry <= 0) {
    return { hasCut: false, cx, cy, rx, ry };
  }
  // `s` is the cut line's height expressed as sin(theta) on the ellipse parametrization, i.e. where
  // y = cy + ry*sin(theta); solving for the two x/theta values where that horizontal line crosses
  // the ellipse gives the flat edge's endpoints.
  const s = Math.max(-0.999, Math.min(0.999, 2 * t - 1));
  const thetaRight = Math.asin(s);
  const thetaLeft = Math.PI - thetaRight;
  const topCutY = cy + ry * s;
  const xRight = cx + rx * Math.cos(thetaRight);
  const xLeft = cx - rx * Math.cos(thetaRight);
  return { hasCut: true, cx, cy, rx, ry, thetaRight, thetaLeft, topCutY, xLeft, xRight };
}

export interface ClampResult {
  cx: number;
  cy: number;
  moved: boolean;
}

/** Pushes a sprite's center point (cx, cy), given its half-width/height (hx, hy), back inside the
 *  tank's chosen shape for a canvas of size w x h - the containment counterpart to the draw-time
 *  clip path (ovalFlatTopGeometry/roundedCornerRadius above). 'rectangle' behaves exactly like a
 *  plain edge clamp (so switching back to it is lossless); 'oval' and 'rounded' shrink that
 *  rectangle by the sprite's own half-extents and test/clamp against an inset ellipse or
 *  rounded-rect so the whole sprite - not just its center - stays inside the visible glass. Used for
 *  every placement/drag/swim site in useTank.ts, so an object dropped in a round tank's corner (or a
 *  fish swimming toward it) can't sit half outside the visible water. */
export function clampCenterToShape(
  shape: TankShape,
  cornerRadiusFrac: number,
  ovalTopCutFrac: number,
  cx: number,
  cy: number,
  hx: number,
  hy: number,
  w: number,
  h: number,
): ClampResult {
  if (shape === 'rectangle' || w <= 0 || h <= 0) {
    const ncx = Math.min(Math.max(cx, hx), Math.max(hx, w - hx));
    const ncy = Math.min(Math.max(cy, hy), Math.max(hy, h - hy));
    return { cx: ncx, cy: ncy, moved: ncx !== cx || ncy !== cy };
  }
  if (shape === 'oval') {
    const ecx = w / 2;
    const ecy = h / 2;
    const rx = Math.max(1, w / 2 - hx);
    const ry = Math.max(1, h / 2 - hy);
    const dx = cx - ecx;
    const dy = cy - ecy;
    const norm = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
    let ncx = cx;
    let ncy = cy;
    let moved = false;
    if (norm > 1) {
      const scale = 1 / Math.sqrt(norm);
      ncx = ecx + dx * scale;
      ncy = ecy + dy * scale;
      moved = true;
    }
    // Flattened top: the exact chord width at the cut line is narrower than the full-ellipse rx used
    // above, but re-deriving it here would only matter right at the two corners where the flat top
    // meets the curve - close enough for physics, exact for the visual clip (ovalFlatTopGeometry).
    const topCut = Math.max(OVAL_TOP_CUT_MIN, Math.min(OVAL_TOP_CUT_MAX, ovalTopCutFrac));
    if (topCut > 0) {
      const topLimit = h * topCut + hy;
      if (ncy < topLimit) {
        ncy = topLimit;
        moved = true;
      }
    }
    return { cx: ncx, cy: ncy, moved };
  }
  // rounded
  let ncx = Math.min(Math.max(cx, hx), Math.max(hx, w - hx));
  let ncy = Math.min(Math.max(cy, hy), Math.max(hy, h - hy));
  const edgeMoved = ncx !== cx || ncy !== cy;
  const r = Math.max(0, Math.min(roundedCornerRadius(w, h, cornerRadiusFrac), w / 2 - hx, h / 2 - hy));
  if (r > 0) {
    const cornerX = ncx < hx + r ? hx + r : ncx > w - hx - r ? w - hx - r : ncx;
    const cornerY = ncy < hy + r ? hy + r : ncy > h - hy - r ? h - hy - r : ncy;
    const ddx = ncx - cornerX;
    const ddy = ncy - cornerY;
    const dist = Math.hypot(ddx, ddy);
    if (dist > r) {
      const scale = r / dist;
      ncx = cornerX + ddx * scale;
      ncy = cornerY + ddy * scale;
      return { cx: ncx, cy: ncy, moved: true };
    }
  }
  return { cx: ncx, cy: ncy, moved: edgeMoved };
}

/** Top-left-anchored convenience wrapper around clampCenterToShape - every call site in useTank.ts
 *  works in top-left x/y, so this keeps them as one-line swaps. */
export function clampTopLeftToShape(
  shape: TankShape,
  cornerRadiusFrac: number,
  ovalTopCutFrac: number,
  x: number,
  y: number,
  pw: number,
  ph: number,
  w: number,
  h: number,
): { x: number; y: number; moved: boolean } {
  const hx = pw / 2;
  const hy = ph / 2;
  const { cx, cy, moved } = clampCenterToShape(shape, cornerRadiusFrac, ovalTopCutFrac, x + hx, y + hy, hx, hy, w, h);
  return { x: cx - hx, y: cy - hy, moved };
}
