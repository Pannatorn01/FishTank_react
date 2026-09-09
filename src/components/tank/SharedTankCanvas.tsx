import { lazy, Suspense, useState } from 'react';
import type { TankEngine } from '@/hooks/useTank';
import { getTankRendererMode } from '@/tank/render/rendererMode';
import { RoomLayer } from './RoomLayer';
import { useTankViewport } from './useTankViewport';

const TankPixiLayer = lazy(() => import('@/tank/render/TankPixiLayer').then((m) => ({ default: m.TankPixiLayer })));

/**
 * Somebody else's tank, as a picture of itself.
 *
 * The same engine, the same renderer, the same geometry (useTankViewport) as the tank the user owns -
 * with every control and every event handler left off. Read-only here means the DOM has nothing to
 * click: no Save, no Refresh, no size inputs, no pointer handlers on the canvas, and room decor behind
 * `pointer-events: none` so it cannot be dragged either. The engine refuses to write regardless (see
 * TankEngine.readOnly), but a view that offers a button it will then refuse is a worse view than one
 * that never offered it.
 *
 * The fish still swim. Nothing about that reaches storage - the simulation only ever moves numbers in
 * memory, and this engine has no way back to disk - and a still photograph of a tank would be a poor
 * way to show someone what they made.
 */
export function SharedTankCanvas({ engine }: { engine: TankEngine }) {
  const [tankRendererMode] = useState(getTankRendererMode);
  const { viewportElRef, effectiveScale, frameStyle, wrapShapeStyle, frameOffset, pixiHostStyle } = useTankViewport(engine);

  return (
    <div className="tank-canvas-col">
      <div
        className="tank-viewport"
        ref={(el) => {
          viewportElRef.current = el;
          engine.attachViewport(el);
        }}
      >
        <div className="tank-frame tank-frame-readonly" style={frameStyle}>
          <div className="tank-wrap" style={wrapShapeStyle} ref={(el) => engine.attachWrap(el)}>
            {/* Still mounted and still drawn into in both renderer modes, for the same reason as in
             * TankCanvas: this canvas is the engine's own drawing surface, not merely a display. */}
            <canvas
              ref={(el) => {
                engine.attachCanvas(el);
                if (el) engine.resizeCanvas();
              }}
              className={`tank-canvas${tankRendererMode === 'pixi' ? ' tank-canvas-hidden' : ''}`}
            />
          </div>
        </div>
        {tankRendererMode === 'pixi' && (
          <Suspense fallback={null}>
            <TankPixiLayer engine={engine} style={pixiHostStyle} />
          </Suspense>
        )}
        <div
          className={tankRendererMode === 'pixi' ? 'tank-room-layer-hidden' : undefined}
          style={{ pointerEvents: 'none' }}
        >
          <RoomLayer engine={engine} frameOffset={frameOffset} effectiveScale={effectiveScale} />
        </div>
      </div>
    </div>
  );
}
