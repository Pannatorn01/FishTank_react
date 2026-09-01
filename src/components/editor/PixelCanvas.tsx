import { useCallback, useEffect, useRef } from 'react';
import type { PixelEditorEngine } from '@/hooks/usePixelEditor';

/** Minimum time between wheel-triggered zoom steps, so a single trackpad pinch/scroll gesture (which fires
 *  many small wheel events) doesn't blow through several zoom levels at once - a time gate is used instead
 *  of a delta-magnitude threshold because deltaY's scale varies by device and by WheelEvent.deltaMode. */
const WHEEL_ZOOM_COOLDOWN_MS = 80;

export function PixelCanvas({ engine }: { engine: PixelEditorEngine }) {
  // A stable ref callback matters here: an inline `(el) => ...` is a new function every render, and
  // React detaches+reattaches on every ref identity change - even though the DOM node hasn't changed.
  // attachCanvas() redraws with no overlay on each reattach, which raced with (and silently wiped) a
  // curve tool preview that's meant to persist across renders while its control-point handle is live.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const attachCanvas = useCallback((el: HTMLCanvasElement | null) => engine.attachCanvas(el), [engine]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const lastWheelZoom = useRef(0);

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
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) engine.deselect();
      }}
    >
      <canvas
        ref={attachCanvas}
        className="pixel-canvas pixelated"
        data-tool={engine.tool}
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
