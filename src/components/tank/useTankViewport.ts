import { useEffect, useRef, useState } from 'react';
import { TANK_SIZE_MAX, TANK_SIZE_MIN, TANK_ZOOM_STEPS, type TankEngine } from '@/hooks/useTank';
import { roomSceneMargin } from '@/lib/storage';

/**
 * The geometry every view of a tank needs: how big to draw it, where it sits inside its viewport, and
 * where the Pixi layer's larger canvas has to be placed so the two line up.
 *
 * Extracted from TankCanvas when a second, read-only view of a tank appeared (SharedTankCanvas). None
 * of this is about editing - it is the same arithmetic whether the tank can be touched or not - and
 * two copies of it would agree until the first time one of them was fixed.
 */
export interface TankViewport {
  /** Attach to the scrolling/centering container. The hook measures this element. */
  viewportElRef: React.MutableRefObject<HTMLDivElement | null>;
  viewportSize: { width: number; height: number };
  /** Fit-to-viewport scale times the current zoom step. */
  effectiveScale: number;
  frameStyle: { width: number; height: number; minWidth: number; minHeight: number; maxWidth: number; maxHeight: number };
  /** Matches the water's rounded/oval silhouette to what the engine actually clips its drawing to. */
  wrapShapeStyle: { borderRadius: string | number } | undefined;
  frameOffset: { left: number; top: number };
  pixiHostStyle: { left: number; top: number; width: number; height: number };
}

export function useTankViewport(engine: TankEngine): TankViewport {
  const viewportElRef = useRef<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });

  // Tracks the viewport's own (fixed-ish, but window-resize-sensitive) content size, so the auto-fit
  // scale below can be recomputed whenever it changes.
  useEffect(() => {
    const el = viewportElRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setViewportSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const tankWidth = engine.tankWidth ?? TANK_SIZE_MIN.width;
  const tankHeight = engine.tankHeight ?? TANK_SIZE_MIN.height;
  // "Fit" = as large as the tank can be drawn while still fitting entirely inside the viewport - the
  // zoom steps are a fraction *of this*, so 100% zoom can never spill outside the viewport the tank is
  // centered in, and shrinking the browser window (or growing the tank past what fits) both just
  // shrink this the same way. Never scales past 1 (a small tank isn't blown up to fill the space).
  const fitScale =
    viewportSize.width > 0 && viewportSize.height > 0
      ? Math.min(1, viewportSize.width / tankWidth, viewportSize.height / tankHeight)
      : 1;
  const effectiveScale = fitScale * TANK_ZOOM_STEPS[engine.zoomIndex];

  useEffect(() => {
    engine.setDisplayScale(effectiveScale);
    engine.resizeCanvas();
  }, [engine, effectiveScale, tankWidth, tankHeight]);

  // min/max are expressed in on-screen px too (scaled the same as width/height), so the native resize
  // handle itself can't be dragged past TANK_SIZE_MIN/MAX in real time - without this, only the
  // pointerup commit (setTankSize's own clamp) enforced the limit, which meant the box would visibly
  // overshoot while dragging and then snap back the moment you let go.
  const frameStyle = {
    width: tankWidth * effectiveScale,
    height: tankHeight * effectiveScale,
    minWidth: TANK_SIZE_MIN.width * effectiveScale,
    minHeight: TANK_SIZE_MIN.height * effectiveScale,
    maxWidth: TANK_SIZE_MAX.width * effectiveScale,
    maxHeight: TANK_SIZE_MAX.height * effectiveScale,
  };

  // Matches the water shape to whatever TankEngine.draw() actually clips its canvas drawing to (see
  // shapePath/clampCenterToShape in useTank.ts) - 'oval' is a plain 50% radius (an ellipse inscribed in
  // any rectangle), 'rounded' mirrors the same corner-radius formula the engine uses for its clip path
  // and physics, so the visible glass edge and the invisible collision edge agree.
  const wrapShapeStyle =
    engine.tankShape === 'oval'
      ? { borderRadius: '50%' }
      : engine.tankShape === 'rounded'
        ? { borderRadius: Math.min(tankWidth, tankHeight) * engine.tankCornerRadiusFrac * effectiveScale }
        : undefined;

  // .tank-frame is centered in .tank-viewport via flexbox (see index.css) - this is that same centering
  // done in JS, so the DOM overlays can convert the engine's canvas-logical coordinates into on-screen
  // positions within the viewport, independent of the frame's own DOM position.
  const frameOffset = {
    left: Math.max(0, (viewportSize.width - frameStyle.width) / 2),
    top: Math.max(0, (viewportSize.height - frameStyle.height) / 2),
  };

  // Sized/positioned bigger than (and centered the same as) .tank-frame - room decor (P2) lives in the
  // margin around the tank rectangle, so the Pixi canvas needs actual pixels to paint there rather than
  // being clipped at the tank's own edge (see TankPixiLayer.tsx's own doc comment).
  const { marginX, marginY, sceneWidth, sceneHeight } = roomSceneMargin(tankWidth, tankHeight);
  const pixiHostStyle = {
    left: frameOffset.left - marginX * effectiveScale,
    top: frameOffset.top - marginY * effectiveScale,
    width: sceneWidth * effectiveScale,
    height: sceneHeight * effectiveScale,
  };

  return { viewportElRef, viewportSize, effectiveScale, frameStyle, wrapShapeStyle, frameOffset, pixiHostStyle };
}
