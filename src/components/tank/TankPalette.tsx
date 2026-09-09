import { SpriteThumb } from '@/components/PixelThumb';
import { useLanguage } from '@/lib/i18n';
import type { Sprite } from '@/lib/types';
import type { TankEngine } from '@/hooks/useTank';

/** Shared with TankLayers.tsx so a sprite's thumbnail is the same physical size whether it shows up
 *  in the Sprites palette or the Tank Layers list - deliberately compact since both live in the same
 *  190px-wide sidebar column. */
export const PALETTE_THUMB_PX = 32;

export function PaletteThumb({ sprite, size = PALETTE_THUMB_PX }: { sprite: Sprite; size?: number }) {
  return <SpriteThumb sprite={sprite} size={size} className="tank-thumb" />;
}

export function TankPalette({ engine }: { engine: TankEngine }) {
  const { t } = useLanguage();
  return (
    <div className="tank-palette">
      <p className="palette-hint">
        {t('tank.dragHint')} <i className="fa-solid fa-arrow-down" />
      </p>
      <div className="tank-palette-list">
        {engine.sprites
          .filter((sprite) => sprite.type !== 'background')
          .map((sprite) => (
          <div
            key={sprite.id}
            className="tank-palette-item"
            onPointerDown={(e) => engine.startPaletteDrag(e, sprite.id)}
          >
            <PaletteThumb sprite={sprite} />
            <span className="tank-palette-item-name" title={sprite.name}>
              <i className={`fa-solid fa-${sprite.type === 'fish' ? 'fish' : sprite.type === 'room' ? 'image' : 'leaf'}`} /> {sprite.name}
            </span>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="tank-clear-btn"
        onClick={() => engine.clearTank(() => confirm(t('tank.clearConfirm')))}
      >
        <i className="fa-solid fa-broom" /> {t('tank.clearAll')}
      </button>
    </div>
  );
}
