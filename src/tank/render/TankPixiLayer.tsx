import type React from 'react';
import { useEffect, useRef } from 'react';
import type { Application } from 'pixi.js';
import type { TankEngine } from '@/hooks/useTank';
import { roomSceneMargin } from '@/lib/storage';
import { invalidateAll, invalidateSprite } from './textureCache';
import { createPixiApp, destroyPixiApp } from './pixiApp';
import { createTankScene, type TankSceneHandle } from './tankScene';

/**
 * Mounted instead of (visually - see TankCanvas.tsx's use of this) the tank's own Canvas2D <canvas>
 * when the `pixi` tank renderer is selected. Owns a Pixi Application sized not to the tank's own
 * logical pixel dimensions but to that *plus* the room-decor margin on every side (see
 * roomSceneMargin) - room decor (P2) lives in that margin, outside the tank rectangle itself, and
 * needs actual canvas pixels there to be visible at all rather than clipped at the tank's own edge.
 * TankCanvas.tsx sizes/positions this component's host div correspondingly (bigger than, and centered
 * the same as, the Canvas2D `.tank-frame` it visually surrounds) so the two line up exactly. Within
 * that bigger backing store, the same "logical size, CSS stretches the element to fit" trick the
 * existing `.tank-canvas` class already relies on (see index.css) still applies - so this component's
 * own host <canvas> only needs the same CSS rule, no extra scale math of its own.
 *
 * Reads the engine's already-simulated, live-mutated state every frame (`engine.instances`,
 * `engine.tankShape`, etc.) exactly the way the engine's own Canvas2D draw() loop always has - from
 * the app's own ticker, not a second requestAnimationFrame loop beside it. Pixi's TickerPlugin
 * already registers `app.render()` on that ticker at UPDATE_PRIORITY.LOW, so a scene update added at
 * the default NORMAL priority is guaranteed to run *before* the render that shows it. A separate rAF
 * loop has no such ordering: whichever of the two callbacks the browser happened to schedule first
 * won, and when it lost, the frame on screen showed the previous frame's positions. Nothing here
 * drives simulation, undo, persistence, or input;
 * TankEngine keeps owning all of that regardless of which renderer is chosen (see
 * docs/PIXI_MIGRATION_PLAN.md §4/§6).
 */
export function TankPixiLayer({ engine, style }: { engine: TankEngine; style: React.CSSProperties }) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let app: Application | null = null;
    let scene: TankSceneHandle | null = null;
    let lastSize = { w: 0, h: 0 };

    const onSpritesUpdated = () => invalidateAll();
    const onSpriteDeleted = (e: Event) => invalidateSprite((e as CustomEvent<{ id: string }>).detail.id);
    window.addEventListener('ft:sprites-updated', onSpritesUpdated);
    window.addEventListener('ft:sprite-deleted', onSpriteDeleted);

    createPixiApp(host, { autoDensity: false }).then((createdApp) => {
      if (cancelled) {
        destroyPixiApp(createdApp);
        return;
      }
      app = createdApp;
      // resolution 1, no autoDensity: the backing store is the tank's logical pixel size, one-to-
      // one with engine.canvas - exactly like the Canvas2D <canvas> it's replacing. CSS (the same
      // width:100%/height:100% rule `.tank-canvas` already uses) does the effectiveScale stretch,
      // so root.mask/instances/etc are all authored directly in tank-logical coordinates, matching
      // Instance.x/y with zero extra scale math.
      app.canvas.classList.add('tank-canvas', 'tank-pixi-canvas');
      // Nothing in this scene is pointer-interactive - the host div is `pointer-events: none` (see
      // .tank-pixi-host in index.css) and every drag/select still goes to the Canvas2D canvas and the
      // DOM RoomLayer underneath (see tankScene.ts's doc comment). Telling Pixi that up front skips
      // the hit-test walk over the whole scene graph on every pointer move.
      app.stage.eventMode = 'none';
      app.stage.interactiveChildren = false;
      scene = createTankScene(app.stage);

      const tick = () => {
        if (cancelled || !app || !scene) return;
        const w = engine.canvas?.width ?? 0;
        const h = engine.canvas?.height ?? 0;
        if (w > 0 && h > 0 && (w !== lastSize.w || h !== lastSize.h)) {
          lastSize = { w, h };
          const { sceneWidth, sceneHeight } = roomSceneMargin(w, h);
          app.renderer.resize(sceneWidth, sceneHeight);
        }
        scene.render(engine);
      };
      app.ticker.add(tick);
    });

    return () => {
      cancelled = true;
      window.removeEventListener('ft:sprites-updated', onSpritesUpdated);
      window.removeEventListener('ft:sprite-deleted', onSpriteDeleted);
      // No explicit ticker.remove(): destroyPixiApp tears the whole app (its ticker included) down a
      // line later, and `cancelled` already makes any callback that slips in between a no-op.
      scene?.destroy();
      if (app) destroyPixiApp(app);
    };
  }, [engine]);

  return <div ref={hostRef} className="tank-pixi-host" style={style} />;
}
