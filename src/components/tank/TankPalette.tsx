import { useEffect, useRef } from 'react';
import { useLanguage } from '@/lib/i18n';
import { paintLayers } from '@/lib/pixelMath';
import type { Sprite } from '@/lib/types';
import type { TankEngine } from '@/hooks/useTank';

const THUMB_PX = 56;

function PaletteThumb({ sprite }: { sprite: Sprite }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const width = sprite.width || 16;
    const height = sprite.height || 16;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const cellPx = THUMB_PX / Math.max(width, height);
    ctx.save();
    ctx.translate((THUMB_PX - width * cellPx) / 2, (THUMB_PX - height * cellPx) / 2);
    paintLayers(ctx, sprite.frames[0], width, height, cellPx);
    ctx.restore();
  }, [sprite]);
  return <canvas ref={ref} width={THUMB_PX} height={THUMB_PX} className="pixelated" />;
}

export function TankPalette({ engine }: { engine: TankEngine }) {
  const { t } = useLanguage();
  return (
    <div className="tank-palette">
      <p className="palette-hint">
        {t('tank.dragHint')} <i className="fa-solid fa-arrow-down" />
      </p>
      <div className="tank-palette-list">
        {engine.sprites.map((sprite) => (
          <div
            key={sprite.id}
            className="tank-palette-item"
            onPointerDown={(e) => engine.startPaletteDrag(e, sprite.id!)}
          >
            <PaletteThumb sprite={sprite} />
            <span>
              <i className={`fa-solid fa-${sprite.type === 'fish' ? 'fish' : 'leaf'}`} /> {sprite.name}
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
