import { useEffect, useRef } from 'react';
import { useLanguage } from '@/lib/i18n';
import { paintLayers } from '@/lib/pixelMath';
import type { Sprite } from '@/lib/types';
import type { PixelEditorEngine } from '@/hooks/usePixelEditor';

const THUMB_PX = 48;

function LibraryThumb({ sprite }: { sprite: Sprite }) {
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

export function SpriteLibrary({
  engine,
  onConfirmDiscard,
  onError,
}: {
  engine: PixelEditorEngine;
  onConfirmDiscard: () => boolean;
  onError: (msg: string) => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="library">
      <h3>{t('library.title')}</h3>
      <div className="library-grid">
        <button
          type="button"
          className="library-add"
          title={t('form.new')}
          onClick={() => engine.newSprite(onConfirmDiscard)}
        >
          <i className="fa-solid fa-plus" />
        </button>
        {engine.sprites.map((sprite) => (
          <div key={sprite.id} className="library-card" onClick={() => engine.loadSpriteForEdit(sprite, onConfirmDiscard)}>
            <LibraryThumb sprite={sprite} />
            <div className="library-label">
              <i className={`fa-solid fa-${sprite.type === 'fish' ? 'fish' : sprite.type === 'room' ? 'image' : 'leaf'}`} /> {sprite.name}
            </div>
            <button
              type="button"
              className="library-del"
              onClick={(e) => {
                e.stopPropagation();
                engine.deleteSprite(sprite.id!, () => confirm(t('library.deleteConfirm')), onError);
              }}
            >
              <i className="fa-solid fa-xmark" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
