import { useCallback, useEffect, useRef, useState } from 'react';
import type { PixelEditorEngine } from '@/hooks/usePixelEditor';

/** Minimum thumb length (px) - a thumb proportional to the visible fraction gets unusably small once
 *  a large canvas is zoomed right in, so it stops shrinking here and the position mapping compensates
 *  (see `contentPerTrackPx`). */
const MIN_THUMB = 24;

type Axis = 'x' | 'y';

/**
 * Overlay pan indicators for .pixel-canvas-wrap, replacing the native scrollbars it used to get from
 * `overflow: auto`. Same information, but drawn *on top of* the canvas area rather than beside it:
 * native scrollbars take real layout space, so one appearing or disappearing (the canvas crossing the
 * wrap's size while zooming, a window resize, a sprite swap) resized the wrap's content box and, via
 * its grid centering, shifted the canvas under the cursor mid-stroke - the "canvas jumps while I draw"
 * bug these exist to fix.
 *
 * Geometry comes from the engine's own viewMetrics(), the same source clampPan works from, so the two
 * can't drift: `rest` is where the canvas's leading edge sits at pan 0 and `pan` moves it from there.
 * Everything below is that relationship solved for the two directions this needs - pan to thumb offset
 * when rendering, track delta to pan delta when dragging.
 */
export function PixelCanvasScrollbars({ engine }: { engine: PixelEditorEngine }) {
  const metrics = engine.viewMetrics();
  // A resize of the wrap changes the thumbs without going through the engine at all, and so does the
  // very first paint (viewMetrics() is null until the canvas is attached, one render too early).
  const [, forceRender] = useState(0);
  const bump = useCallback(() => forceRender((n) => n + 1), []);

  useEffect(() => {
    const wrap = engine.canvas?.parentElement?.parentElement;
    if (!wrap || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(bump);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [engine, engine.canvas, bump]);

  if (!metrics) return null;
  return (
    <>
      <ScrollbarAxis axis="x" engine={engine} viewport={metrics.wrapW} content={metrics.canvasW} rest={metrics.restX} onPan={bump} />
      <ScrollbarAxis axis="y" engine={engine} viewport={metrics.wrapH} content={metrics.canvasH} rest={metrics.restY} onPan={bump} />
    </>
  );
}

function ScrollbarAxis({
  axis,
  engine,
  viewport,
  content,
  rest,
  onPan,
}: {
  axis: Axis;
  engine: PixelEditorEngine;
  viewport: number;
  content: number;
  rest: number;
  onPan: () => void;
}) {
  const dragRef = useRef<{ client: number; pointerId: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  // Nothing to indicate while the whole canvas fits: there's no hidden content for a scrollbar to be
  // about, and panning in that regime is a deliberate nudge, not navigation.
  if (content <= viewport + 1) return null;

  const pan = axis === 'x' ? engine.panX : engine.panY;
  // Track length excludes the 3px inset the CSS gives both ends.
  const track = viewport - 6;
  const overflow = content - viewport;
  const thumb = Math.max(MIN_THUMB, (viewport / content) * track);
  // How much content is hidden past the viewport's leading edge, in content px: 0 when the canvas's
  // left/top edge is flush with the viewport's, `overflow` when its right/bottom edge is.
  const hidden = Math.min(overflow, Math.max(0, -(rest + pan)));
  const offset = overflow > 0 ? (hidden / overflow) * (track - thumb) : 0;
  // The thumb travels (track - thumb) px while the content travels `overflow` px - not 1:1, and more
  // so the smaller MIN_THUMB has forced the thumb to be.
  const contentPerTrackPx = track - thumb > 0 ? overflow / (track - thumb) : 0;

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const client = axis === 'x' ? e.clientX : e.clientY;
    const delta = (client - drag.client) * contentPerTrackPx;
    dragRef.current = { ...drag, client };
    // Dragging the thumb right moves the *content* left, hence the negation.
    engine.panBy(axis === 'x' ? -delta : 0, axis === 'y' ? -delta : 0);
    onPan();
  };

  return (
    <div
      className="pixel-canvas-scrollbar"
      data-axis={axis}
      data-dragging={dragging || undefined}
      onPointerDown={(e) => {
        // Stops .pixel-canvas-wrap's own pointerdown from reading a scrollbar grab as a click on empty
        // canvas background and clearing the selection.
        e.stopPropagation();
        e.preventDefault();
        dragRef.current = { client: axis === 'x' ? e.clientX : e.clientY, pointerId: e.pointerId };
        setDragging(true);
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => {
        dragRef.current = null;
        setDragging(false);
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => {
        dragRef.current = null;
        setDragging(false);
      }}
    >
      <div
        className="pixel-canvas-scrollbar-thumb"
        style={axis === 'x' ? { left: offset, width: thumb } : { top: offset, height: thumb }}
      />
    </div>
  );
}
