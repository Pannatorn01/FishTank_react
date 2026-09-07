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
 * Runs its own requestAnimationFrame loop reading the engine's already-simulated, live-mutated state
 * every frame (`engine.instances`, `engine.tankShape`, etc.) exactly the way the engine's own
 * Canvas2D draw() loop always has - nothing here drives simulation, undo, persistence, or input;
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
    let rafId = 0;
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
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    });

    return () => {
      cancelled = true;
      window.removeEventListener('ft:sprites-updated', onSpritesUpdated);
      window.removeEventListener('ft:sprite-deleted', onSpriteDeleted);
      if (rafId) cancelAnimationFrame(rafId);
      scene?.destroy();
      if (app) destroyPixiApp(app);
    };
  }, [engine]);

  return <div ref={hostRef} className="tank-pixi-host" style={style} />;
}
