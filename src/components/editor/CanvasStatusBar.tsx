import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ZOOM_LEVELS } from '@/hooks/usePixelEditor';
import type { PixelEditorEngine } from '@/hooks/usePixelEditor';
import { useLanguage } from '@/lib/i18n';
import { GRID_SIZES } from '@/lib/storage';
import type { SymmetryMode } from '@/lib/types';

const SYMMETRY_KEYS: Record<SymmetryMode, string> = {
  none: 'symmetry.none',
  vertical: 'symmetry.vertical',
  horizontal: 'symmetry.horizontal',
  both: 'symmetry.both',
};

export function CanvasStatusBar({ engine }: { engine: PixelEditorEngine }) {
  const { t } = useLanguage();
  const showShapeFilled = engine.tool === 'rect' || engine.tool === 'ellipse';
  const selection = engine.selection;

  return (
    <div className="canvas-status-bar">
      <div className="zoom-controls">
        <Button
          type="button"
          size="icon"
          variant="secondary"
          title={t('status.zoomOut')}
          disabled={engine.zoomIndex === 0}
          onClick={() => engine.zoomOut()}
        >
          <i className="fa-solid fa-magnifying-glass-minus" />
        </Button>
        <span id="zoom-label">{engine.zoomLabel()}</span>
        <Button
          type="button"
          size="icon"
          variant="secondary"
          title={t('status.zoomIn')}
          disabled={engine.zoomIndex === ZOOM_LEVELS.length - 1}
          onClick={() => engine.zoomIn()}
        >
          <i className="fa-solid fa-magnifying-glass-plus" />
        </Button>
      </div>

      <Select value={String(engine.current.size)} onValueChange={(v) => engine.setGridSize(Number(v))}>
        <SelectTrigger className="w-28 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {GRID_SIZES.map((size) => (
            <SelectItem key={size} value={String(size)}>
              {size}×{size}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <label className="mini-toggle">
        <Checkbox checked={engine.showGrid} onCheckedChange={(v) => engine.setShowGrid(!!v)} />
        <Label>{t('status.showGrid')}</Label>
      </label>

      {showShapeFilled && (
        <label className="mini-toggle">
          <Checkbox checked={engine.shapeFilled} onCheckedChange={(v) => engine.setShapeFilled(!!v)} />
          <Label>{t('status.fillShape')}</Label>
        </label>
      )}

      <Select value={engine.symmetry} onValueChange={(v) => engine.setSymmetry(v as SymmetryMode)}>
        <SelectTrigger className="w-56 text-xs" title={t('status.symmetryTitle')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(SYMMETRY_KEYS) as SymmetryMode[]).map((mode) => (
            <SelectItem key={mode} value={mode}>
              {t(SYMMETRY_KEYS[mode])}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {selection && (
        <span className="selection-info" title={t('status.selectionHint')}>
          <i className="fa-solid fa-vector-square" />{' '}
          {t('status.selectionSize', { w: selection.x1 - selection.x0 + 1, h: selection.y1 - selection.y0 + 1 })}
        </span>
      )}
    </div>
  );
}
