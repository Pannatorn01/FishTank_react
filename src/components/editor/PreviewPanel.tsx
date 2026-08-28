import { Checkbox } from '@/components/ui/8bit/checkbox';
import { Label } from '@/components/ui/8bit/label';
import type { PixelEditorEngine } from '@/hooks/usePixelEditor';

export function PreviewPanel({ engine }: { engine: PixelEditorEngine }) {
  return (
    <div className="preview-panel">
      <canvas ref={(el) => engine.attachPreviewCanvas(el)} width={120} height={120} className="preview-canvas pixelated" />
      <label className="mini-toggle">
        <Checkbox checked={engine.onionSkin} onCheckedChange={(v) => engine.setOnionSkin(!!v)} />
        <Label>Onion Skin</Label>
      </label>
    </div>
  );
}
