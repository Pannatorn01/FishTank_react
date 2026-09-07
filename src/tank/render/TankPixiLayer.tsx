import { useEffect, useRef } from 'react';
import type { Application } from 'pixi.js';
import type { TankEngine } from '@/hooks/useTank';
import { invalidateAll, invalidateSprite } from './textureCache';
import { createPixiApp, destroyPixiApp } from './pixiApp';
import { createTankScene, type TankSceneHandle } from './tankScene';

/**
 * Mounted instead of (visually - see TankCanvas.tsx's use of this) the tank's own Canvas2D <canvas>
 * when the `pixi` tank renderer is selected. Owns a Pixi Application sized to exactly the tank's
 * logical pixel dimensions (`engine.canvas.width/height` - never the on-screen, effectiveScale'd
 * size), the same "backing store at logical size, CSS stretches the element to fit" trick the
 * existing `.tank-canvas` class already relies on (see index.css) - so this component's own host
 * <canvas> only needs the same CSS rule, no extra scale math of its own.
 *
 * Runs its own requestAnimationFrame loop reading the engine's already-simulated, live-mutated state
 * every frame (`engine.instances`, `engine.tankShape`, etc.) exactly the way the engine's own
 * Canvas2D draw() loop always has - nothing here drives simulation, undo, persistence, or input;
 * TankEngine keeps owning all of that regardless of which renderer is chosen (see
 * docs/PIXI_MIGRATION_PLAN.md §4/§6 P1).
 */
export function TankPixiLayer({ engine }: { engine: TankEngine }) {
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
          app.renderer.resize(w, h);
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

  return <div ref={hostRef} className="tank-pixi-host" />;
}
