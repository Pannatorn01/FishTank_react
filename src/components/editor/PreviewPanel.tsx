import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { PixelEditorEngine } from '@/hooks/usePixelEditor';
import { useLanguage } from '@/lib/i18n';
import { MAX_FRAME_FPS, MIN_FRAME_FPS } from '@/lib/storage';

export function PreviewPanel({ engine }: { engine: PixelEditorEngine }) {
  const { t } = useLanguage();
  const fps = Math.round((1000 / engine.current.frameMs) * 10) / 10;
  return (
    <div className="preview-panel">
      <canvas ref={(el) => engine.attachPreviewCanvas(el)} width={80} height={80} className="preview-canvas pixelated" />
      <label className="mini-toggle">
        <Checkbox checked={engine.onionSkin} onCheckedChange={(v) => engine.setOnionSkin(!!v)} />
        <Label>{t('preview.onionSkin')}</Label>
      </label>
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
