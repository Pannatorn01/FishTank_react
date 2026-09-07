import { describe, expect, it } from 'vitest';
import { withSelectionClip, withSymmetry } from '../paintPipeline';
import type { PaintOp } from '../types';

describe('withSelectionClip', () => {
  it('passes an op inside a rectangular selection', () => {
    const out: PaintOp[] = [];
    const sink = withSelectionClip({ x0: 0, y0: 0, x1: 3, y1: 3 }, null, (op) => out.push(op));
    sink({ x: 2, y: 2, color: '#fff' });
    expect(out).toEqual([{ x: 2, y: 2, color: '#fff' }]);
  });

  it('drops an op outside a rectangular selection', () => {
    const out: PaintOp[] = [];
    const sink = withSelectionClip({ x0: 0, y0: 0, x1: 3, y1: 3 }, null, (op) => out.push(op));
    sink({ x: 5, y: 5, color: '#fff' });
    expect(out).toEqual([]);
  });

  it('drops an op inside the bbox but outside a sparse mask', () => {
    const out: PaintOp[] = [];
    const mask = new Set(['0,0', '1,1']);
    const sink = withSelectionClip({ x0: 0, y0: 0, x1: 3, y1: 3 }, mask, (op) => out.push(op));
    sink({ x: 1, y: 1, color: '#fff' });
    sink({ x: 2, y: 2, color: '#fff' });
    expect(out).toEqual([{ x: 1, y: 1, color: '#fff' }]);
  });

  it('passes everything through when there is no selection', () => {
    const out: PaintOp[] = [];
    const sink = withSelectionClip(null, null, (op) => out.push(op));
    sink({ x: -50, y: 999, color: '#fff' });
    expect(out).toHaveLength(1);
  });
});

describe('withSymmetry', () => {
  it('does not duplicate a cell exactly on the axis', () => {
    const out: PaintOp[] = [];
    // Axis at x=5.5 (between cell 5 and 6) means cell x=5's mirror is itself only when relX==0;
    // here we pick the axis so the source cell sits exactly on it.
    const sink = withSymmetry('vertical', 5.5, 5.5, (op) => out.push(op));
    sink({ x: 5, y: 5, color: '#fff' });
    expect(out).toHaveLength(1);
  });

  it('mirrors off-axis vertically around the default canvas-center axis', () => {
    const out: PaintOp[] = [];
    const sink = withSymmetry('vertical', 8, 8, (op) => out.push(op));
    sink({ x: 2, y: 3, color: '#fff' });
    expect(out).toContainEqual({ x: 2, y: 3, color: '#fff' });
    expect(out).toContainEqual({ x: 13, y: 3, color: '#fff' });
    expect(out).toHaveLength(2);
  });

  it('composes with withSelectionClip - mirrored cell outside selection is dropped, original kept', () => {
    const out: PaintOp[] = [];
    const sink = withSymmetry('vertical', 8, 8, withSelectionClip({ x0: 0, y0: 0, x1: 5, y1: 20 }, null, (op) => out.push(op)));
    sink({ x: 2, y: 3, color: '#fff' });
    expect(out).toEqual([{ x: 2, y: 3, color: '#fff' }]);
  });

  it('none symmetry passes the op through unmirrored', () => {
    const out: PaintOp[] = [];
    const sink = withSymmetry('none', 8, 8, (op) => out.push(op));
    sink({ x: 2, y: 3, color: '#fff' });
    expect(out).toEqual([{ x: 2, y: 3, color: '#fff' }]);
  });
});
