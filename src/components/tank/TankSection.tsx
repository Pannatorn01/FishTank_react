import { useEffect } from 'react';
import { useTank } from '@/hooks/useTank';
import { useLanguage } from '@/lib/i18n';
import { LifePanel } from './LifePanel';
import { TankPanel } from './TankPanel';

export type TankMode = 'build' | 'life';

/**
 * Owns the single `useTank()` engine instance shared by Build mode (`TankPanel`, the existing
 * layout/arrangement editor) and Life mode (`LifePanel`, the read-only room-placement preview added
 * in P4 - see docs/PIXI_MIGRATION_PLAN.md §6/§14). Both call sites used to instantiate their own
 * engine via a `useTank()` call inside TankPanel itself; with two modes now needing to show the *same*
 * tank/fish state at once, the hook call had to move up to a shared ancestor instead of each mode
 * quietly holding its own independent copy (which would only agree right after a save+reload).
 *
 * Both mode panels stay mounted simultaneously (toggled with `hidden`, not conditional rendering) for
 * the same reason TankPanel itself has always stayed mounted across the editor/tank tab switch - the
 * engine's running requestAnimationFrame loop and Pixi Application(s) shouldn't tear down and rebuild
 * every time the user flips between Build and Life.
 */
export function TankSection({ mode, active }: { mode: TankMode; active: boolean }) {
  const engine = useTank();
  const { t } = useLanguage();

  useEffect(() => {
    const onSpritesUpdated = () => engine.refreshPalette();
    const onSpriteDeleted = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail.id;
      engine.removeInstancesBySprite(id);
    };
    window.addEventListener('ft:sprites-updated', onSpritesUpdated);
    window.addEventListener('ft:sprite-deleted', onSpriteDeleted);
    return () => {
      window.removeEventListener('ft:sprites-updated', onSpritesUpdated);
      window.removeEventListener('ft:sprite-deleted', onSpriteDeleted);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    engine.setActive(active);
    if (active) {
      engine.resizeCanvas();
      engine.refreshPalette();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Same reason as the editor's gate in App.tsx: an un-hydrated engine has an empty tank, and an empty
  // tank on screen is indistinguishable from one the user just lost.
  if (!engine.ready) return <p className="tab-panel-loading">{t('app.loading')}</p>;

  return (
    <>
      <div className="tank-mode-panel" hidden={mode !== 'build'}>
        <TankPanel engine={engine} />
      </div>
      <div className="tank-mode-panel" hidden={mode !== 'life'}>
        <LifePanel engine={engine} />
      </div>
    </>
  );
}
