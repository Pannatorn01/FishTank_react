import { useLanguage } from '@/lib/i18n';
import type { TankEngine } from '@/hooks/useTank';
import { PaletteThumb } from './TankPalette';

export function TankBackgroundPanel({ engine }: { engine: TankEngine }) {
  const { t } = useLanguage();
  const backgrounds = engine.sprites.filter((s) => s.type === 'background');
  const selected = engine.backgroundSpriteId ? backgrounds.find((s) => s.id === engine.backgroundSpriteId) : null;

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

      {selected && (
        <div className="tank-bg-position">
          <label className="tank-bg-position-row">
            <span>{t('tank.backgroundPositionX')}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={engine.backgroundOffsetXFrac}
              onChange={(e) => engine.setBackgroundOffset(parseFloat(e.target.value), engine.backgroundOffsetYFrac)}
            />
          </label>
          <label className="tank-bg-position-row">
            <span>{t('tank.backgroundPositionY')}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={engine.backgroundOffsetYFrac}
              onChange={(e) => engine.setBackgroundOffset(engine.backgroundOffsetXFrac, parseFloat(e.target.value))}
            />
          </label>
        </div>
      )}
    </div>
  );
}
