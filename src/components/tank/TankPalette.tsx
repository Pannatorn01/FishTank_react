import { useEffect, useRef } from 'react';
import { useLanguage } from '@/lib/i18n';
import { paintLayers } from '@/lib/pixelMath';
import type { Sprite } from '@/lib/types';
import type { TankEngine } from '@/hooks/useTank';

/** Shared with TankLayers.tsx so a sprite's thumbnail is the same physical size whether it shows up
 *  in the Sprites palette or the Tank Layers list - deliberately compact since both live in the same
 *  190px-wide sidebar column. */
export const PALETTE_THUMB_PX = 32;

export function PaletteThumb({ sprite, size = PALETTE_THUMB_PX }: { sprite: Sprite; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const width = sprite.width || 16;
    const height = sprite.height || 16;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const cellPx = size / Math.max(width, height);
    ctx.save();
    ctx.translate((size - width * cellPx) / 2, (size - height * cellPx) / 2);
    paintLayers(ctx, sprite.frames[0], width, height, cellPx);
    ctx.restore();
  }, [sprite, size]);
  return <canvas ref={ref} width={size} height={size} className="pixelated tank-thumb" />;
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
            onPointerDown={(e) => engine.startPaletteDrag(e, sprite.id!)}
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
