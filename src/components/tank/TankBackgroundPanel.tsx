import { useEffect } from 'react';
import { useLanguage } from '@/lib/i18n';
import type { TankEngine } from '@/hooks/useTank';
import { PaletteThumb } from './TankPalette';

export function TankBackgroundPanel({ engine }: { engine: TankEngine }) {
  const { t } = useLanguage();
  const backgrounds = engine.sprites.filter((s) => s.type === 'background');

  // The on-canvas move/resize/rotate handles (see TankEngine.backgroundEditing) are only meaningful
  // while this tab is the one showing - turned off on unmount so switching to Layers/Sprites doesn't
  // leave a stale transform box intercepting clicks meant for placing/selecting fish.
  useEffect(() => {
    engine.setBackgroundEditing(true);
    return () => engine.setBackgroundEditing(false);
  }, [engine]);

  return (
    <div className="tank-palette">
      <p className="palette-hint">{t('tank.backgroundHint')}</p>
      <div className="tank-palette-list">
        <div
          className={`tank-palette-item tank-bg-item${engine.backgroundSpriteId === null ? ' active' : ''}`}
          onClick={() => engine.setTankBackgroundSprite(null)}
        >
          <div className="tank-bg-thumb tank-bg-thumb-default" />
          <span className="tank-palette-item-name">{t('tank.backgroundDefault')}</span>
        </div>
        {backgrounds.map((sprite) => (
          <div
            key={sprite.id}
            className={`tank-palette-item tank-bg-item${engine.backgroundSpriteId === sprite.id ? ' active' : ''}`}
            onClick={() => engine.setTankBackgroundSprite(sprite.id)}
          >
            <PaletteThumb sprite={sprite} />
            <span className="tank-palette-item-name" title={sprite.name}>
              {sprite.name}
            </span>
          </div>
        ))}
      </div>
      {backgrounds.length === 0 && <p className="palette-hint">{t('tank.backgroundEmpty')}</p>}
    </div>
  );
}
