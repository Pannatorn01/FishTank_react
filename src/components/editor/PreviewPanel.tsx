import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import type { PixelEditorEngine } from '@/hooks/usePixelEditor';
import { useLanguage } from '@/lib/i18n';

export function PreviewPanel({ engine }: { engine: PixelEditorEngine }) {
  const { t } = useLanguage();
  return (
    <div className="preview-panel">
      <canvas ref={(el) => engine.attachPreviewCanvas(el)} width={80} height={80} className="preview-canvas pixelated" />
      <label className="mini-toggle">
        <Checkbox checked={engine.onionSkin} onCheckedChange={(v) => engine.setOnionSkin(!!v)} />
        <Label>{t('preview.onionSkin')}</Label>
      </label>
    </div>
  );
}
