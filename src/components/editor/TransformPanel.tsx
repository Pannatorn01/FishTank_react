import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import type { PixelEditorEngine } from '@/hooks/usePixelEditor';
import { useLanguage } from '@/lib/i18n';

export function TransformPanel({ engine }: { engine: PixelEditorEngine }) {
  const { t } = useLanguage();
  return (
    <div className="transform-panel">
      <span className="panel-title">{t('transform.title')}</span>
      <div className="transform-buttons">
        <Button type="button" size="icon" variant="secondary" title={t('transform.flipH')} onClick={() => engine.flipH()}>
          <i className="fa-solid fa-left-right" />
        </Button>
        <Button type="button" size="icon" variant="secondary" title={t('transform.flipV')} onClick={() => engine.flipV()}>
          <i className="fa-solid fa-up-down" />
        </Button>
        <Button type="button" size="icon" variant="secondary" title={t('transform.rotateCCW')} onClick={() => engine.rotateCCW()}>
          <i className="fa-solid fa-rotate-left" />
        </Button>
        <Button type="button" size="icon" variant="secondary" title={t('transform.rotateCW')} onClick={() => engine.rotateCW()}>
          <i className="fa-solid fa-rotate-right" />
        </Button>
      </div>
      <label className="mini-toggle">
        <Checkbox checked={engine.transformAllFrames} onCheckedChange={(v) => engine.setTransformAllFrames(!!v)} />
        <Label>{t('transform.allFrames')}</Label>
      </label>
    </div>
  );
}
