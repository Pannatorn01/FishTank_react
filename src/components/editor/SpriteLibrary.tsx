import { useEffect, useRef } from 'react';
import { useLanguage } from '@/lib/i18n';
import { paintFrameCells } from '@/lib/pixelMath';
import type { Sprite } from '@/lib/types';
import type { PixelEditorEngine } from '@/hooks/usePixelEditor';

function LibraryThumb({ sprite }: { sprite: Sprite }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const size = sprite.size || 16;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    paintFrameCells(ctx, sprite.frames[0], size, 48 / size);
  }, [sprite]);
  return <canvas ref={ref} width={48} height={48} className="pixelated" />;
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
        {engine.sprites.map((sprite) => (
          <div key={sprite.id} className="library-card" onClick={() => engine.loadSpriteForEdit(sprite, onConfirmDiscard)}>
            <LibraryThumb sprite={sprite} />
            <div className="library-label">
              <i className={`fa-solid fa-${sprite.type === 'fish' ? 'fish' : 'leaf'}`} /> {sprite.name}
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
