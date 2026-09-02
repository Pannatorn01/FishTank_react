import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { PixelEditorEngine } from '@/hooks/usePixelEditor';

/** Minimum time between wheel-triggered zoom steps, so a single trackpad pinch/scroll gesture (which fires
 *  many small wheel events) doesn't blow through several zoom levels at once - a time gate is used instead
 *  of a delta-magnitude threshold because deltaY's scale varies by device and by WheelEvent.deltaMode. */
const WHEEL_ZOOM_COOLDOWN_MS = 80;

/** Tools that paint with the brush-size stepper (see CanvasStatusBar's `showBrushOptions`) - these get a
 *  cursor sized to the actual brush footprint instead of the static per-tool icon from index.css. */
const BRUSH_TOOLS = new Set(['pen', 'eraser', 'spray']);

/** Tools with no brush-size control - line/curve always draw a 1px stroke - but that still benefit from
 *  the same zoom-scaled footprint cursor (a single-cell square) instead of the fixed-size static icon,
 *  so the cursor's outline actually matches the cell it'll paint at any zoom level. */
const SINGLE_CELL_CURSOR_TOOLS = new Set(['line', 'curve']);

/**
 * Builds a `cursor: url(...)` value showing the brush's actual on-screen footprint: a square outline
 * `brushSize` cells wide, sized in real screen pixels at the current zoom (so it grows/shrinks live as
 * either changes) and centered on the pointer. A static CSS cursor (as used for every other tool, see
 * index.css) can't do this since it can't read `brushSize`/zoom - only inline `style` can update per
 * render. The square is centered on the pointer rather than snapped to `brushCells()`'s exact top-left
 * anchoring, since the cursor image can't know the canvas's scroll offset anyway - close enough to show
 * "how big" without pretending to be pixel-exact about "which cells."
 */
function buildBrushCursor(brushSize: number, cellPx: number): string {
  const size = brushSize * cellPx;
  const pad = 6;
  const dim = Math.round(size + pad * 2);
  const c = dim / 2;
  const half = size / 2;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${dim}' height='${dim}' viewBox='0 0 ${dim} ${dim}'>` +
    `<rect x='${c - half}' y='${c - half}' width='${size}' height='${size}' fill='none' stroke='white' stroke-width='4'/>` +
    `<rect x='${c - half}' y='${c - half}' width='${size}' height='${size}' fill='none' stroke='black' stroke-width='1.5'/>` +
    `<line x1='${c}' y1='${c - 3}' x2='${c}' y2='${c + 3}' stroke='black' stroke-width='1'/>` +
    `<line x1='${c - 3}' y1='${c}' x2='${c + 3}' y2='${c}' stroke='black' stroke-width='1'/>` +
    `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${c} ${c}, crosshair`;
}

export function PixelCanvas({ engine }: { engine: PixelEditorEngine }) {
  // A stable ref callback matters here: an inline `(el) => ...` is a new function every render, and
  // React detaches+reattaches on every ref identity change - even though the DOM node hasn't changed.
  // attachCanvas() redraws with no overlay on each reattach, which raced with (and silently wiped) a
  // curve tool preview that's meant to persist across renders while its control-point handle is live.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const attachCanvas = useCallback((el: HTMLCanvasElement | null) => engine.attachCanvas(el), [engine]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const lastWheelZoom = useRef(0);

  const brushCursor = useMemo(() => {
    if (BRUSH_TOOLS.has(engine.tool)) return buildBrushCursor(engine.brushSize, engine.effectiveCellPx());
    if (SINGLE_CELL_CURSOR_TOOLS.has(engine.tool)) return buildBrushCursor(1, engine.effectiveCellPx());
    return undefined;
  }, [engine.tool, engine.brushSize, engine.zoomIndex]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    // React 17+ registers wheel listeners as passive at the root, so a synthetic onWheel prop can't
    // preventDefault() the browser's own ctrl+wheel page zoom - a native, non-passive listener can.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const now = performance.now();
      if (now - lastWheelZoom.current < WHEEL_ZOOM_COOLDOWN_MS) return;
      lastWheelZoom.current = now;
      if (e.deltaY < 0) engine.zoomIn();
      else if (e.deltaY > 0) engine.zoomOut();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [engine]);

  return (
    <div
      ref={wrapRef}
      className="pixel-canvas-wrap"
      data-tool={engine.tool}
      style={brushCursor ? { cursor: brushCursor } : undefined}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) engine.deselect();
      }}
    >
      <canvas
        ref={attachCanvas}
        className="pixel-canvas pixelated"
        data-bg={engine.canvasBackground}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => engine.onPointerDown(e)}
        onPointerMove={(e) => engine.onPointerMove(e)}
        onPointerUp={() => engine.onPointerUp()}
        onPointerCancel={() => engine.onPointerUp()}
      />
    </div>
  );
}
