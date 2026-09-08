import { useEffect, useRef } from 'react';
import type { Application } from 'pixi.js';
import { Button } from '@/components/ui/button';
import type { TankEngine } from '@/hooks/useTank';
import { useLanguage } from '@/lib/i18n';
import { createPixiApp, destroyPixiApp } from '@/tank/render/pixiApp';
import { createRoomScene, type RoomSceneHandle } from '@/tank/render/roomScene';
import { invalidateAll, invalidateSprite } from '@/tank/render/textureCache';

/**
 * Life mode (P4, docs/PIXI_MIGRATION_PLAN.md §6/§14) - the tank placed in a room. Started as a
 * view-only preview (per §9 Q10) with the care mechanics (P5) layered in afterward - tapping the tank
 * now feeds fish or collects waste (see engine.handleTankTap).
 *
 * Owns its own Pixi Application, separate from Build mode's TankPixiLayer - the two are different
 * scenes (a full room vs. just the tank+margin) shown one at a time, not two views of one canvas.
 * Uses `autoDensity: true` (unlike TankPixiLayer) since this canvas fills its own container directly
 * rather than being stretched by external CSS math tied to the tank's logical pixel size.
 */
export function LifePanel({ engine }: { engine: TankEngine }) {
  const { t } = useLanguage();
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
      // Tank tap (P5 §6 items 2-3, docs/PIXI_MIGRATION_PLAN.md) - tapping waste collects it, tapping
      // open water drops a food pellet there. `engine.handleTankTap` clamps whatever coordinates it's
      // given into the tank's own bounds when it falls through to feeding, so this doesn't need its
      // own precise hit-testing against the tank's shape (see tapHitArea's doc comment in
      // roomScene.ts). Dragging instead of tapping scrubs algae (P5 §6 item 5) - roomScene.ts tells
      // the two apart by total drag distance, so onTap only ever fires for an actual short tap.
      scene = createRoomScene(
        app.stage,
        (x, y) => engine.handleTankTap(x, y),
        (dist) => engine.scrubAlgae(dist),
      );

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
      {/* Water level (P5 §6 item 4) - a plain DOM button rather than a Pixi-drawn one, matching every
       *  other action button in this app (Save, zoom, etc.) - simpler than hand-rolling hit-testing
       *  and a hover/pressed state inside the Pixi scene for something that isn't part of the tank
       *  itself. */}
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="life-refill-button"
        title={t('life.refillWaterTitle')}
        onClick={() => engine.refillWater()}
      >
        <i className="fa-solid fa-faucet-drip" /> {t('life.refillWater')}
      </Button>
      {/* Nothing about the tank itself hints that tapping vs. dragging do two different things (see
       *  roomScene.ts's tap-vs-drag state machine) - especially before any algae has actually grown in
       *  yet, at which point there's nothing visible to even suspect is scrubbable. A plain caption
       *  under the tank spells it out once instead of leaving it to be discovered by accident. */}
      <p className="life-hint">{t('life.hint')}</p>
    </div>
  );
}
