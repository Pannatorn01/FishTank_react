import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import type { PixelEditorEngine } from '@/hooks/usePixelEditor';
import { useLanguage } from '@/lib/i18n';
import { paintFrameCells } from '@/lib/pixelMath';
import type { Frame } from '@/lib/types';

function FrameThumb({ frame, size, active, onClick }: { frame: Frame; size: number; active: boolean; onClick: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    paintFrameCells(ctx, frame, size, 32 / size);
  }, [frame, size]);
  return (
    <button type="button" className={`frame-thumb-wrap${active ? ' active' : ''}`} onClick={onClick}>
      <canvas ref={ref} width={32} height={32} className="frame-thumb pixelated" />
    </button>
  );
}

export function FrameStrip({ engine }: { engine: PixelEditorEngine }) {
  const { t } = useLanguage();
  const limitReached = engine.frameLimitReached();
  return (
    <div className="frame-row">
      <div className="frame-strip">
        {engine.current.frames.map((frame, i) => (
          <div key={i} className="frame-badge-wrap">
            <FrameThumb frame={frame} size={engine.current.size} active={i === engine.frameIndex} onClick={() => engine.selectFrame(i)} />
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
