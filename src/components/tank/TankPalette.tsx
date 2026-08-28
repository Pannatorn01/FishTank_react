import { useEffect, useRef } from 'react';
import { paintFrameCells } from '@/lib/pixelMath';
import type { Sprite } from '@/lib/types';
import type { TankEngine } from '@/hooks/useTank';

function PaletteThumb({ sprite }: { sprite: Sprite }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const size = sprite.size || 16;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    paintFrameCells(ctx, sprite.frames[0], size, 56 / size);
  }, [sprite]);
  return <canvas ref={ref} width={56} height={56} className="pixelated" />;
}

export function TankPalette({ engine }: { engine: TankEngine }) {
  return (
    <div className="tank-palette">
      <p className="palette-hint">
        ลากปลา/ของตกแต่งลงตู้ปลา <i className="fa-solid fa-arrow-down" />
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
        onClick={() => engine.clearTank(() => confirm('ล้างของทั้งหมดในตู้ปลา?'))}
      >
        <i className="fa-solid fa-broom" /> ล้างตู้ปลาทั้งหมด
      </button>
    </div>
  );
}
