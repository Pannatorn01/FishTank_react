import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BRUSH_SIZE_TOOLS, MAX_BRUSH_SIZE, type PixelEditorEngine } from '@/hooks/usePixelEditor';
import { useLanguage } from '@/lib/i18n';
import type { SymmetryMode } from '@/lib/types';

const SYMMETRY_KEYS: Record<SymmetryMode, string> = {
  none: 'symmetry.none',
  vertical: 'symmetry.vertical',
  horizontal: 'symmetry.horizontal',
  both: 'symmetry.both',
  diagonal: 'symmetry.diagonal',
  radial: 'symmetry.radial',
};

/**
 * The options belonging to whatever tool is currently selected, in a bar directly above the canvas -
 * Photoshop's tool options bar. These all used to sit in CanvasStatusBar with the zoom controls, the
 * canvas size and the background picker, which mixed two unrelated kinds of control in one long row:
 * "how does this tool behave right now" (changes constantly, tool by tool) and "what am I looking at"
 * (set once and left alone). Splitting them means the row above the canvas only ever shows what
 * applies to the active tool, and the row below it stops moving around as tools change.
 *
 * Renders nothing at all for a tool with no options (eyedropper, move), rather than an empty bar.
 */
export function ToolOptionsBar({ engine }: { engine: PixelEditorEngine }) {
  const { t } = useLanguage();
  const showBrushSize = BRUSH_SIZE_TOOLS.has(engine.tool);
  const showShapeFilled = engine.tool === 'rect' || engine.tool === 'ellipse';
  const showTolerance = engine.tool === 'fill' || engine.tool === 'magicWand';
  const showDither = engine.tool === 'gradient' || showBrushSize;
  // Symmetry mirrors whatever a paint tool draws, so it belongs to the same set of tools the brush
  // size does - and it's worth still showing while it's ON for any tool, so an active mirror is never
  // invisible.
  const showSymmetry = showBrushSize || engine.tool === 'fill' || engine.symmetry !== 'none';

  if (!showBrushSize && !showShapeFilled && !showTolerance && !showDither && !showSymmetry) return null;

  return (
    <div className="tool-options-bar">
      <span className="tool-options-name" title={t(`tool.${engine.tool}.desc`)}>
        {t(`tool.${engine.tool}.short`)}
      </span>

      {showBrushSize && (
        <div className="mini-toggle brush-size-control" title={t('status.brushSizeTitle')}>
          <Label htmlFor="brush-size-range">{t('status.brushSize')}</Label>
          <input
            id="brush-size-range"
            type="range"
            min={1}
            max={MAX_BRUSH_SIZE}
            step={1}
            value={engine.brushSize}
            onChange={(e) => engine.setBrushSize(Number(e.target.value))}
            className="brush-size-slider"
          />
          <Input
            type="number"
            min={1}
            max={MAX_BRUSH_SIZE}
            value={engine.brushSize}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) engine.setBrushSize(n);
            }}
            className="w-14 h-7 px-1.5 text-center text-xs"
            aria-label={t('status.brushSize')}
          />
          <span className="brush-size-unit">{t('status.brushSizeUnit')}</span>
        </div>
      )}

      {showTolerance && (
        <div className="mini-toggle brush-size-control" title={t('status.fillToleranceTitle')}>
          <Label htmlFor="fill-tolerance-range">{t('status.fillTolerance')}</Label>
          <input
            id="fill-tolerance-range"
            type="range"
            min={0}
            max={100}
            step={1}
            value={engine.fillTolerance}
            onChange={(e) => engine.setFillTolerance(Number(e.target.value))}
            className="brush-size-slider"
          />
          <Input
            type="number"
            min={0}
            max={100}
            value={engine.fillTolerance}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) engine.setFillTolerance(n);
            }}
            className="w-14 h-7 px-1.5 text-center text-xs"
            aria-label={t('status.fillTolerance')}
          />
        </div>
      )}

      {showShapeFilled && (
        <label className="mini-toggle">
          <Checkbox checked={engine.shapeFilled} onCheckedChange={(v) => engine.setShapeFilled(!!v)} />
          <Label>{t('status.fillShape')}</Label>
        </label>
      )}

      {showDither && (
        <label className="mini-toggle" title={t('status.ditherTitle')}>
          <Checkbox checked={engine.ditherEnabled} onCheckedChange={(v) => engine.setDitherEnabled(!!v)} />
          <Label>{t('status.dither')}</Label>
        </label>
      )}

      {showSymmetry && (
        <>
          <span className="toolbar-divider" aria-hidden="true" />
          <Select value={engine.symmetry} onValueChange={(v) => engine.setSymmetry(v as SymmetryMode)}>
            <SelectTrigger className="w-48 text-xs" title={t('status.symmetryTitle')}>
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
          {engine.symmetry !== 'none' && (
            <Button
              type="button"
              size="icon"
              variant="secondary"
              title={t('status.resetSymmetryAxis')}
              onClick={() => engine.resetSymmetryAxis()}
            >
              <i className="fa-solid fa-crosshairs" />
            </Button>
          )}
        </>
      )}
    </div>
  );
}
