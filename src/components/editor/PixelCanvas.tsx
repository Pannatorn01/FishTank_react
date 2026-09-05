import { useCallback, useEffect, useRef } from 'react';
import type { PixelEditorEngine } from '@/hooks/usePixelEditor';
import { PixelSelectionOverlay } from './PixelSelectionOverlay';

export function PixelCanvas({ engine }: { engine: PixelEditorEngine }) {
  // A stable ref callback matters here: an inline `(el) => ...` is a new function every render, and
  // React detaches+reattaches on every ref identity change - even though the DOM node hasn't changed.
  // attachCanvas() redraws with no overlay on each reattach, which raced with (and silently wiped) a
  // curve tool preview that's meant to persist across renders while its control-point handle is live.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const attachCanvas = useCallback((el: HTMLCanvasElement | null) => engine.attachCanvas(el), [engine]);

  const wrapRef = useRef<HTMLDivElement>(null);
  // Accumulates same-frame wheel deltas into one target scale+anchor, applied at most once per
  // animation frame (see onWheel below) - setZoom measures the canvas's actual on-screen position for
  // the zoom-to-cursor math (see its own doc comment), and calling that on every single wheel event (a
  // fast trackpad pinch can fire dozens between two browser paints) would both be wasted work and risk
  // layout thrashing (write a style, then read layout geometry, repeated). The zoom % still tracks the
  // gesture essentially in real time since rAF runs every ~16ms - well under what's perceptible as lag
  // - it just never redoes the work more than once per displayed frame.
  const pendingZoom = useRef<{ scale: number; clientX: number; clientY: number } | null>(null);
  const zoomRafId = useRef<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    // React 17+ registers wheel listeners as passive at the root, so a synthetic onWheel prop can't
    // preventDefault() the browser's own ctrl+wheel page zoom - a native, non-passive listener can.
    const onWheel = (e: WheelEvent) => {
      // Ctrl/Cmd+wheel = zoom (browsers also report a trackpad pinch gesture as wheel+ctrlKey,
      // regardless of whether Ctrl is actually held, so this covers pinch-to-zoom too); plain wheel is
      // left alone entirely so it keeps panning the canvas via the wrap's native overflow:auto scroll.
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      // Multiplicative and continuous, not a fixed per-tick amount: exp(-deltaY * k) means a regular
      // mouse wheel's much larger per-notch deltaY (~100) zooms in bigger, snappier steps while a
      // trackpad's much smaller per-event deltaY yields smooth, fine-grained zooming - both from the
      // same formula, and either way proportionate to the current zoom rather than a fixed +/- amount.
      const factor = Math.exp(-e.deltaY * 0.0015);
      const base = pendingZoom.current?.scale ?? engine.zoomScale;
      pendingZoom.current = { scale: base * factor, clientX: e.clientX, clientY: e.clientY };
      if (zoomRafId.current === null) {
        zoomRafId.current = requestAnimationFrame(() => {
          zoomRafId.current = null;
          if (pendingZoom.current) {
            engine.setZoom(pendingZoom.current.scale, pendingZoom.current);
            pendingZoom.current = null;
          }
        });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (zoomRafId.current !== null) cancelAnimationFrame(zoomRafId.current);
    };
  }, [engine]);

  return (
    <div
      ref={wrapRef}
      className="pixel-canvas-wrap"
      data-tool={engine.tool}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) engine.deselect();
      }}
      onPointerMove={(e) => engine.updateHoverPointer(e)}
      onPointerLeave={() => engine.clearHoverPointer()}
    >
      <div
        className="pixel-canvas-inner"
        style={engine.panX || engine.panY ? { transform: `translate(${engine.panX}px, ${engine.panY}px)` } : undefined}
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
        <PixelSelectionOverlay engine={engine} />
      </div>
    </div>
  );
}
