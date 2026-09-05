import { HANDLE_CURSORS, HANDLE_SIZE, ROTATE_HANDLE_RADIUS, type PixelEditorEngine } from '@/hooks/usePixelEditor';
import { t } from '@/lib/i18n';

/** Everything drawn "on top of" the pixel editor's <canvas> that isn't sprite content itself - the
 *  select tool's border/resize handles/rotate handle, the in-progress marquee while dragging one out,
 *  grid lines, symmetry guides, and the curve tool's control handle. All DOM elements living in
 *  .pixel-canvas-inner (sibling to the <canvas>, same trick as the tank's TankBackgroundOverlay)
 *  rather than drawn on the canvas itself - partly so the settled selection stays visible/grabbable
 *  even when moved/resized fully outside the canvas's own bitmap (Paint-style floating selection),
 *  but mainly because the canvas is native-resolution now (1px per cell - see recomputeCanvasSize in
 *  usePixelEditor.ts, done so painting on a large canvas doesn't lag): at that resolution there's no
 *  room to draw a hairline *between* cells, or a fixed-size (e.g. 6px) handle glyph, on the canvas
 *  itself - every "chrome" element here is sized in real screen px against .pixel-canvas-inner's CSS
 *  box instead, independent of the canvas's internal pixel grid. The rotate handle's connecting stalk
 *  and the symmetry guides are SVG lines rather than CSS-rotated/bordered divs since they're
 *  arbitrary-angle or full-span segments between independently-computed points, not simple boxes. */
export function PixelSelectionOverlay({ engine }: { engine: PixelEditorEngine }) {
  const box = engine.selectionOverlayBox();
  const rotate = engine.selectionRotateHandle();
  const cellPx = engine.effectiveCellPx();
  const { width, height } = engine.current;
  const draft = engine.selectionDraft;
  const brushPreview = engine.brushPreviewRect();
  const lassoOutline = engine.selectionLassoOutline();
  const lassoDraft = engine.lassoDraftOutline();
  const curveHandle =
    engine.tool === 'curve' && engine.curvePhase === 'bend' && engine.curveControl
      ? { x: (engine.curveControl.x + 0.5) * cellPx, y: (engine.curveControl.y + 0.5) * cellPx }
      : null;

  return (
    <>
      {engine.showGrid && (
        <div
          className="pixel-grid-overlay"
          style={{
            width: width * cellPx,
            height: height * cellPx,
            backgroundImage:
              `repeating-linear-gradient(to right, rgba(255,255,255,0.1) 0 1px, transparent 1px ${cellPx}px),` +
              `repeating-linear-gradient(to bottom, rgba(255,255,255,0.1) 0 1px, transparent 1px ${cellPx}px)`,
          }}
        />
      )}
      {brushPreview && (
        <div
          className="brush-preview-outline"
          style={{ left: brushPreview.left, top: brushPreview.top, width: brushPreview.size, height: brushPreview.size }}
        />
      )}
      {engine.symmetry !== 'none' && (
        <>
          <svg className="pixel-select-stalk-svg" width={width * cellPx} height={height * cellPx}>
            {(engine.symmetry === 'vertical' || engine.symmetry === 'both') && (
              <line x1={engine.symmetryAxisX * cellPx} y1={0} x2={engine.symmetryAxisX * cellPx} y2={height * cellPx} stroke="rgba(0,229,255,0.6)" strokeWidth={1} strokeDasharray="3 3" />
            )}
            {(engine.symmetry === 'horizontal' || engine.symmetry === 'both') && (
              <line x1={0} y1={engine.symmetryAxisY * cellPx} x2={width * cellPx} y2={engine.symmetryAxisY * cellPx} stroke="rgba(0,229,255,0.6)" strokeWidth={1} strokeDasharray="3 3" />
            )}
            {engine.symmetry === 'diagonal' && (
              <>
                <line
                  x1={engine.symmetryAxisX * cellPx - 2000}
                  y1={engine.symmetryAxisY * cellPx - 2000}
                  x2={engine.symmetryAxisX * cellPx + 2000}
                  y2={engine.symmetryAxisY * cellPx + 2000}
                  stroke="rgba(0,229,255,0.6)"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
                <line
                  x1={engine.symmetryAxisX * cellPx - 2000}
                  y1={engine.symmetryAxisY * cellPx + 2000}
                  x2={engine.symmetryAxisX * cellPx + 2000}
                  y2={engine.symmetryAxisY * cellPx - 2000}
                  stroke="rgba(0,229,255,0.6)"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
              </>
            )}
            {engine.symmetry === 'radial' && (
              <circle
                cx={engine.symmetryAxisX * cellPx}
                cy={engine.symmetryAxisY * cellPx}
                r={18}
                fill="none"
                stroke="rgba(0,229,255,0.6)"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
            )}
          </svg>
          <div
            className="pixel-symmetry-axis-handle"
            title={t('status.symmetryAxisHandle')}
            style={{ left: engine.symmetryAxisX * cellPx, top: engine.symmetryAxisY * cellPx }}
            onPointerDown={(e) => {
              e.stopPropagation();
              engine.startAxisDrag();
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => engine.updateAxisDrag(e)}
            onPointerUp={() => engine.endAxisDrag()}
            onPointerCancel={() => engine.endAxisDrag()}
          />
        </>
      )}
      {draft && (
        <div
          className="pixel-select-border"
          style={{
            left: draft.x0 * cellPx,
            top: draft.y0 * cellPx,
            width: (draft.x1 - draft.x0 + 1) * cellPx,
            height: (draft.y1 - draft.y0 + 1) * cellPx,
          }}
        />
      )}
      {lassoDraft && (
        <svg className="pixel-select-stalk-svg" width={width * cellPx} height={height * cellPx}>
          <polyline points={lassoDraft.points} fill="none" stroke="#ffeb3b" strokeWidth={2} strokeDasharray="4 3" />
        </svg>
      )}
      {lassoOutline && (
        <svg className="pixel-select-stalk-svg" width={width * cellPx} height={height * cellPx}>
          <polygon points={lassoOutline.points} className="pixel-select-lasso-outline" />
        </svg>
      )}
      {curveHandle && (
        <div
          className="pixel-curve-handle"
          style={{
            left: curveHandle.x,
            top: curveHandle.y,
            width: HANDLE_SIZE,
            height: HANDLE_SIZE,
            margin: `-${HANDLE_SIZE / 2}px 0 0 -${HANDLE_SIZE / 2}px`,
          }}
        />
      )}
      {box && (
        <>
          <div
            className="pixel-select-border"
            style={{ left: box.x0, top: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0 }}
          />
          {box.handles.map((h) => (
            <div
              key={h.name}
              className="pixel-select-resize-handle"
              style={{
                left: h.x,
                top: h.y,
                width: HANDLE_SIZE,
                height: HANDLE_SIZE,
                margin: `-${HANDLE_SIZE / 2}px 0 0 -${HANDLE_SIZE / 2}px`,
                cursor: HANDLE_CURSORS[h.name],
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                engine.startResizeDrag(h.name);
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => engine.updateResizeDrag(e)}
              onPointerUp={() => engine.endResizeDrag()}
              onPointerCancel={() => engine.endResizeDrag()}
            />
          ))}
        </>
      )}
      {rotate && (
        <>
          {/* The stalk's own SVG box is sized to exactly wrap the mx/y0-to-hx/hy segment (not the
           *  canvas's own box, unlike the symmetry lines above) - the handle sits *above* the canvas
           *  (negative y), so that segment falls entirely outside a canvas-sized box, and relying on
           *  overflow:visible to paint content that's entirely outside an SVG's own box turns out not
           *  to work reliably in Chromium (only "extends past one edge" reliably does). Line
           *  coordinates are shifted into the box's own local space (x1 - minX, etc.). */}
          <svg
            className="pixel-select-stalk-svg"
            style={{ left: Math.min(rotate.mx, rotate.hx), top: Math.min(rotate.y0, rotate.hy) }}
            width={Math.max(1, Math.abs(rotate.hx - rotate.mx))}
            height={Math.max(1, Math.abs(rotate.hy - rotate.y0))}
          >
            <line
              x1={rotate.mx - Math.min(rotate.mx, rotate.hx)}
              y1={rotate.y0 - Math.min(rotate.y0, rotate.hy)}
              x2={rotate.hx - Math.min(rotate.mx, rotate.hx)}
              y2={rotate.hy - Math.min(rotate.y0, rotate.hy)}
              stroke="#ffeb3b"
              strokeWidth={2}
              strokeDasharray="4 3"
            />
          </svg>
          <div
            className="pixel-select-rotate-handle"
            style={{
              left: rotate.hx,
              top: rotate.hy,
              width: ROTATE_HANDLE_RADIUS * 2,
              height: ROTATE_HANDLE_RADIUS * 2,
              margin: `-${ROTATE_HANDLE_RADIUS}px 0 0 -${ROTATE_HANDLE_RADIUS}px`,
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              engine.startRotateDrag(e);
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => engine.updateRotateDrag(e)}
            onPointerUp={() => engine.endRotateDrag()}
            onPointerCancel={() => engine.endRotateDrag()}
          />
        </>
      )}
    </>
  );
}
