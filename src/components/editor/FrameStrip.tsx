import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { PixelEditorEngine } from '@/hooks/usePixelEditor';
import { useLanguage } from '@/lib/i18n';
import { paintLayers } from '@/lib/pixelMath';
import type { Layer, SpriteType } from '@/lib/types';

const THUMB_PX = 52;

function FrameThumb({
  layers,
  width,
  height,
  active,
  onClick,
}: {
  layers: Layer[];
  width: number;
  height: number;
  active: boolean;
  onClick: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const cellPx = THUMB_PX / Math.max(width, height);
    ctx.save();
    ctx.translate((THUMB_PX - width * cellPx) / 2, (THUMB_PX - height * cellPx) / 2);
    paintLayers(ctx, layers, width, height, cellPx);
    ctx.restore();
  });
  return (
    <button type="button" className={`frame-thumb-wrap${active ? ' active' : ''}`} onClick={onClick} tabIndex={-1}>
      <canvas ref={ref} width={THUMB_PX} height={THUMB_PX} className="frame-thumb pixelated" />
    </button>
  );
}

export function FrameStrip({ engine, type }: { engine: PixelEditorEngine; type: SpriteType }) {
  const { t } = useLanguage();
  // A background is a single static image, never animated (see TankEngine's background paint,
  // which always draws frame 0) - so adding/duplicating frames is disabled for it rather than
  // letting the artist build a multi-frame background that the tank would never actually cycle.
  const isBackground = type === 'background';
  const limitReached = engine.frameLimitReached() || isBackground;
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const endDrag = () => {
    setDragIndex(null);
    setOverIndex(null);
  };

  return (
    <div className="frame-row">
      <div className="frame-strip">
        {engine.current.frames.map((layers, i) => (
          <div
            key={i}
            className={[
              'frame-badge-wrap',
              dragIndex === i && 'dragging',
              overIndex === i && dragIndex !== null && dragIndex !== i && 'drag-over',
            ].filter(Boolean).join(' ')}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              setDragIndex(i);
            }}
            onDragEnd={endDrag}
            onDragOver={(e) => {
              e.preventDefault();
              if (overIndex !== i) setOverIndex(i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex !== null && dragIndex !== i) engine.moveFrame(dragIndex, i);
              endDrag();
            }}
          >
            <FrameThumb
              layers={layers}
              width={engine.current.width}
              height={engine.current.height}
              active={i === engine.frameIndex}
              onClick={() => engine.selectFrame(i)}
            />
            <span className="frame-num">{i + 1}</span>
          </div>
        ))}
      </div>
      <div className="frame-controls">
        <Button type="button" size="sm" variant="secondary" disabled={limitReached} onClick={() => engine.addFrame()}>
          <i className="fa-solid fa-plus" /> {t('frame.add')}
        </Button>
        <Button type="button" size="sm" variant="secondary" disabled={limitReached} onClick={() => engine.dupFrame()}>
          <i className="fa-solid fa-clone" /> {t('frame.duplicate')}
        </Button>
        <Button type="button" size="sm" variant="secondary" disabled={engine.current.frames.length <= 1} onClick={() => engine.delFrame()}>
          <i className="fa-solid fa-trash" /> {t('frame.delete')}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => engine.clearFrame()}>
          <i className="fa-solid fa-broom" /> {t('frame.clear')}
        </Button>
      </div>
    </div>
  );
}
