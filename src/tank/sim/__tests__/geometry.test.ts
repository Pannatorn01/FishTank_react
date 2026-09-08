import { describe, expect, it } from 'vitest';
import { clampCenterToShape, clampTopLeftToShape, ovalFlatTopGeometry, roundedCornerRadius } from '../geometry';

describe('roundedCornerRadius', () => {
  it('scales off the smaller dimension', () => {
    expect(roundedCornerRadius(200, 100, 0.2)).toBe(20); // min(200,100) * 0.2
    expect(roundedCornerRadius(100, 200, 0.2)).toBe(20); // symmetric in w/h
  });

  it('clamps an out-of-range fraction to ROUNDED_RADIUS_MIN/MAX before applying it', () => {
    expect(roundedCornerRadius(100, 100, 0)).toBe(5); // clamped up to ROUNDED_RADIUS_MIN (0.05)
    expect(roundedCornerRadius(100, 100, 10)).toBe(50); // clamped down to ROUNDED_RADIUS_MAX (0.5)
  });
});

describe('ovalFlatTopGeometry', () => {
  it('returns a plain full ellipse when the cut fraction is ~0', () => {
    const geo = ovalFlatTopGeometry(200, 100, 0);
    expect(geo.hasCut).toBe(false);
    if (!geo.hasCut) {
      expect(geo).toEqual({ hasCut: false, cx: 100, cy: 50, rx: 100, ry: 50 });
    }
  });

  it('produces a symmetric flat top for a mid-range cut', () => {
    const geo = ovalFlatTopGeometry(200, 100, 0.25);
    expect(geo.hasCut).toBe(true);
    if (geo.hasCut) {
      // Symmetric around the vertical center line.
      expect(geo.xLeft).toBeCloseTo(200 - geo.xRight, 6);
      // The flat top sits above center (smaller y) and below the very top of the ellipse (cy - ry).
      expect(geo.topCutY).toBeGreaterThan(geo.cy - geo.ry);
      expect(geo.topCutY).toBeLessThan(geo.cy);
      // thetaLeft/thetaRight bracket the bottom of the ellipse (theta = PI/2) - the curved part of
      // the boundary sweeps from thetaRight through there up to thetaLeft.
      expect(geo.thetaRight).toBeLessThan(Math.PI / 2);
      expect(geo.thetaLeft).toBeGreaterThan(Math.PI / 2);
    }
  });

  it('clamps the cut fraction to OVAL_TOP_CUT_MIN/MAX', () => {
    const tooMuch = ovalFlatTopGeometry(200, 100, 10);
    const atMax = ovalFlatTopGeometry(200, 100, 0.45);
    expect(tooMuch).toEqual(atMax);
  });

  it('degenerates to a full ellipse when the tank has no height', () => {
    const geo = ovalFlatTopGeometry(200, 0, 0.25);
    expect(geo.hasCut).toBe(false);
  });
});

describe('clampCenterToShape', () => {
  it('rectangle: behaves as a plain edge clamp (lossless when already inside)', () => {
    const inside = clampCenterToShape('rectangle', 0.2, 0.25, 50, 50, 10, 10, 100, 100);
    expect(inside).toEqual({ cx: 50, cy: 50, moved: false });

    const outside = clampCenterToShape('rectangle', 0.2, 0.25, -5, 200, 10, 10, 100, 100);
    expect(outside.moved).toBe(true);
    expect(outside.cx).toBe(10); // clamped to hx
    expect(outside.cy).toBe(90); // clamped to h - hy
  });

  it('oval: a center already inside the inset ellipse is untouched', () => {
    const r = clampCenterToShape('oval', 0.2, 0, 100, 100, 10, 10, 200, 200);
    expect(r).toEqual({ cx: 100, cy: 100, moved: false });
  });

  it('oval: a center outside the inset ellipse is pulled back onto its boundary', () => {
    const r = clampCenterToShape('oval', 0.2, 0, 195, 100, 10, 10, 200, 200);
    expect(r.moved).toBe(true);
    // Pulled back along the same direction from center (100,100), landing close to the ellipse edge.
    expect(r.cx).toBeLessThan(195);
    expect(r.cx).toBeGreaterThan(100);
  });

  it('oval: a flat top cut pushes a too-high center down to the cut line', () => {
    const withoutCut = clampCenterToShape('oval', 0.2, 0, 100, 15, 10, 10, 200, 200);
    expect(withoutCut.moved).toBe(false); // fine against the plain ellipse

    const withCut = clampCenterToShape('oval', 0.2, 0.3, 100, 15, 10, 10, 200, 200);
    expect(withCut.moved).toBe(true);
    expect(withCut.cy).toBeCloseTo(200 * 0.3 + 10, 6); // h*topCut + hy
  });

  it('rounded: a center inside a corner-radius inset is untouched', () => {
    const r = clampCenterToShape('rounded', 0.1, 0, 100, 100, 10, 10, 200, 200);
    expect(r).toEqual({ cx: 100, cy: 100, moved: false });
  });

  it('rounded: a center in the actual corner cut is pulled onto the rounded boundary', () => {
    // Top-left corner region, well inside where a plain edge clamp would allow it but the rounded
    // cut should not.
    const r = clampCenterToShape('rounded', 0.3, 0, 12, 12, 10, 10, 200, 200);
    expect(r.moved).toBe(true);
    // Pulled away from the exact corner, not just edge-clamped to (10,10).
    expect(r.cx).toBeGreaterThan(10);
    expect(r.cy).toBeGreaterThan(10);
  });
});

describe('clampTopLeftToShape', () => {
  it('is the top-left-anchored equivalent of clampCenterToShape (same shape, offset by half-size)', () => {
    const pw = 20;
    const ph = 20;
    const centerResult = clampCenterToShape('oval', 0.2, 0, 195, 100, pw / 2, ph / 2, 200, 200);
    const topLeftResult = clampTopLeftToShape('oval', 0.2, 0, 195 - pw / 2, 100 - ph / 2, pw, ph, 200, 200);
    expect(topLeftResult.x).toBeCloseTo(centerResult.cx - pw / 2, 6);
    expect(topLeftResult.y).toBeCloseTo(centerResult.cy - ph / 2, 6);
    expect(topLeftResult.moved).toBe(centerResult.moved);
  });
});
