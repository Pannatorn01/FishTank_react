import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { PixelEditorEngine } from '@/hooks/usePixelEditor';
import { useLanguage } from '@/lib/i18n';
import { MAX_FRAME_FPS, MIN_FRAME_FPS } from '@/lib/storage';
import type { SpriteType } from '@/lib/types';

export function PreviewPanel({ engine, type }: { engine: PixelEditorEngine; type: SpriteType }) {
  const { t } = useLanguage();
  const fps = Math.round((1000 / engine.current.frameMs) * 10) / 10;
  return (
    <div className="preview-panel">
      <canvas ref={(el) => engine.attachPreviewCanvas(el)} width={160} height={160} className="preview-canvas pixelated" />
      <label className="mini-toggle">
        <Checkbox checked={engine.onionSkin} onCheckedChange={(v) => engine.setOnionSkin(!!v)} />
        <Label>{t('preview.onionSkin')}</Label>
      </label>
      {engine.onionSkin && (
        <div className="mini-toggle" title={t('preview.onionDepthTitle')}>
          <Label htmlFor="onion-depth">{t('preview.onionDepth')}</Label>
          <Input
            id="onion-depth"
            type="number"
            min={1}
            max={2}
            value={engine.onionSkinDepth}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) engine.setOnionSkinDepth(v);
            }}
            className="w-12 h-7 px-1 text-center text-xs"
          />
        </div>
      )}
      {type === 'background' && (
        <>
          <label className="mini-toggle" title={t('preview.tiledTitle')}>
            <Checkbox checked={engine.tiledPreview} onCheckedChange={(v) => engine.setTiledPreview(!!v)} />
            <Label>{t('preview.tiled')}</Label>
          </label>
          <Button type="button" size="sm" variant="secondary" title={t('preview.wrapShiftTitle')} onClick={() => engine.applyWrapShift()}>
            <i className="fa-solid fa-arrows-spin" /> {t('preview.wrapShift')}
          </Button>
        </>
      )}
      <div className="preview-speed">
        <Label htmlFor="preview-fps">{t('preview.speed')}</Label>
        <Input
          id="preview-fps"
          type="number"
          min={MIN_FRAME_FPS}
          max={MAX_FRAME_FPS}
          step={0.5}
          value={fps}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v > 0) engine.setFrameSpeed(v);
          }}
        />
        <span className="preview-speed-unit">{t('preview.fps')}</span>
      </div>
    </div>
  );
}
