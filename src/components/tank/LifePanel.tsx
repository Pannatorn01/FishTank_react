import { useEffect, useRef } from 'react';
import type { Application } from 'pixi.js';
import type { TankEngine } from '@/hooks/useTank';
import { createPixiApp, destroyPixiApp } from '@/tank/render/pixiApp';
import { createRoomScene, type RoomSceneHandle } from '@/tank/render/roomScene';
import { invalidateAll, invalidateSprite } from '@/tank/render/textureCache';

/**
 * Life mode (P4, docs/PIXI_MIGRATION_PLAN.md §6/§14) - the tank placed in a room, view-only for now
 * (per §9 Q10: "Life mode = ดูอย่างเดียวไปก่อน" - the care mechanics themselves are P5, not built yet).
 *
 * Owns its own Pixi Application, separate from Build mode's TankPixiLayer - the two are different
 * scenes (a full room vs. just the tank+margin) shown one at a time, not two views of one canvas.
 * Uses `autoDensity: true` (unlike TankPixiLayer) since this canvas fills its own container directly
 * rather than being stretched by external CSS math tied to the tank's logical pixel size.
 */
export function LifePanel({ engine }: { engine: TankEngine }) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let app: Application | null = null;
    let scene: RoomSceneHandle | null = null;
    let rafId = 0;

    const onSpritesUpdated = () => invalidateAll();
    const onSpriteDeleted = (e: Event) => invalidateSprite((e as CustomEvent<{ id: string }>).detail.id);
    window.addEventListener('ft:sprites-updated', onSpritesUpdated);
    window.addEventListener('ft:sprite-deleted', onSpriteDeleted);

    createPixiApp(host).then((createdApp) => {
      if (cancelled) {
        destroyPixiApp(createdApp);
        return;
      }
      app = createdApp;
      app.canvas.classList.add('life-pixi-canvas');
      scene = createRoomScene(app.stage);

      const tick = () => {
        if (cancelled || !app || !scene) return;
        scene.render(engine, app.renderer.width, app.renderer.height);
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

  return (
    <div className="life-layout">
      <div ref={hostRef} className="life-pixi-host" />
    </div>
  );
}
