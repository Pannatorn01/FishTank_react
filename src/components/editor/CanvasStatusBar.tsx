import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MAX_BRUSH_SIZE, ZOOM_LEVELS } from '@/hooks/usePixelEditor';
import type { PixelEditorEngine } from '@/hooks/usePixelEditor';
import { useLanguage } from '@/lib/i18n';
import { GRID_SIZES, MAX_GRID_SIZE, MIN_GRID_SIZE } from '@/lib/storage';
import type { CanvasBackground, SymmetryMode } from '@/lib/types';

const CUSTOM_SIZE_VALUE = 'custom';
const BRUSH_SIZES = Array.from({ length: MAX_BRUSH_SIZE }, (_, i) => i + 1);

const SYMMETRY_KEYS: Record<SymmetryMode, string> = {
  none: 'symmetry.none',
  vertical: 'symmetry.vertical',
  horizontal: 'symmetry.horizontal',
  both: 'symmetry.both',
};

const CANVAS_BG_KEYS: Record<CanvasBackground, string> = {
  'checker-dark': 'status.bgCheckerDark',
  'checker-light': 'status.bgCheckerLight',
  white: 'status.bgWhite',
  black: 'status.bgBlack',
  gray: 'status.bgGray',
};

function clampGridSize(n: number): number {
  return Math.min(MAX_GRID_SIZE, Math.max(MIN_GRID_SIZE, Math.round(n)));
}

export function CanvasStatusBar({ engine }: { engine: PixelEditorEngine }) {
  const { t } = useLanguage();
  const showShapeFilled = engine.tool === 'rect' || engine.tool === 'ellipse';
  const showBrushOptions = engine.tool === 'pen' || engine.tool === 'eraser' || engine.tool === 'spray';
  const selection = engine.selection;
  const { width, height } = engine.current;
  const [customOpen, setCustomOpen] = useState(false);
  const [customWidth, setCustomWidth] = useState('');
  const [customHeight, setCustomHeight] = useState('');

  const confirmCustomSize = (e?: { preventDefault: () => void }) => {
    const w = Number(customWidth);
    const h = Number(customHeight);
    if (!customWidth.trim() || !customHeight.trim() || !Number.isFinite(w) || !Number.isFinite(h)) {
      e?.preventDefault();
      return;
    }
    engine.setGridSize(clampGridSize(w), clampGridSize(h));
    setCustomOpen(false);
  };

  const sizeValue = `${width}x${height}`;
  const isKnownSize = GRID_SIZES.includes(width) && width === height;

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

      <Select
        value={sizeValue}
        onValueChange={(v) => {
          if (v === CUSTOM_SIZE_VALUE) {
            setCustomWidth(String(width));
            setCustomHeight(String(height));
            setCustomOpen(true);
            return;
          }
          const [w, h] = v.split('x').map(Number);
          engine.setGridSize(w, h);
        }}
      >
        <SelectTrigger className="w-28 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {GRID_SIZES.map((size) => (
            <SelectItem key={size} value={`${size}x${size}`}>
              {size}×{size}
            </SelectItem>
          ))}
          {!isKnownSize && (
            <SelectItem value={sizeValue}>
              {width}×{height}
            </SelectItem>
          )}
          <SelectItem value={CUSTOM_SIZE_VALUE}>{t('status.gridCustom')}</SelectItem>
        </SelectContent>
      </Select>

      <AlertDialog open={customOpen} onOpenChange={setCustomOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('status.gridCustomTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('status.gridCustomDesc', { min: MIN_GRID_SIZE, max: MAX_GRID_SIZE })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="custom-grid-width">{t('status.gridWidthLabel')}</Label>
              <Input
                id="custom-grid-width"
                type="number"
                min={MIN_GRID_SIZE}
                max={MAX_GRID_SIZE}
                value={customWidth}
                onChange={(e) => setCustomWidth(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') confirmCustomSize();
                }}
                autoFocus
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="custom-grid-height">{t('status.gridHeightLabel')}</Label>
              <Input
                id="custom-grid-height"
                type="number"
                min={MIN_GRID_SIZE}
                max={MAX_GRID_SIZE}
                value={customHeight}
                onChange={(e) => setCustomHeight(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') confirmCustomSize();
                }}
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('status.gridCustomCancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmCustomSize}>{t('status.gridCustomConfirm')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <label className="mini-toggle">
        <Checkbox checked={engine.showGrid} onCheckedChange={(v) => engine.setShowGrid(!!v)} />
        <Label>{t('status.showGrid')}</Label>
      </label>

      <Select value={engine.canvasBackground} onValueChange={(v) => engine.setCanvasBackground(v as CanvasBackground)}>
        <SelectTrigger className="w-44 text-xs" title={t('status.canvasBgTitle')}>
          <SelectValue>
            <span className="bg-swatch" data-bg={engine.canvasBackground} aria-hidden="true" />
            {t(CANVAS_BG_KEYS[engine.canvasBackground])}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(CANVAS_BG_KEYS) as CanvasBackground[]).map((bg) => (
            <SelectItem key={bg} value={bg}>
              <span className="bg-swatch" data-bg={bg} aria-hidden="true" />
              {t(CANVAS_BG_KEYS[bg])}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {(showShapeFilled || showBrushOptions) && <span className="toolbar-divider" aria-hidden="true" />}

      {showShapeFilled && (
        <label className="mini-toggle">
          <Checkbox checked={engine.shapeFilled} onCheckedChange={(v) => engine.setShapeFilled(!!v)} />
          <Label>{t('status.fillShape')}</Label>
        </label>
      )}

      {showBrushOptions && (
        <div className="mini-toggle" title={t('status.brushSizeTitle')}>
          <Label>{t('status.brushSize')}</Label>
          <div className="brush-size-group">
            {BRUSH_SIZES.map((n) => (
              <button
                key={n}
                type="button"
                className={`brush-size-btn${engine.brushSize === n ? ' active' : ''}`}
                title={t('status.brushSizeValue', { n })}
                onClick={() => engine.setBrushSize(n)}
              >
                <span className="brush-size-dot" style={{ width: n * 3 + 2, height: n * 3 + 2 }} />
              </button>
            ))}
          </div>
        </div>
      )}

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

      {selection && (
        <span className="selection-info" title={t('status.selectionHint')}>
          <i className="fa-solid fa-vector-square" />{' '}
          {t('status.selectionSize', { w: selection.x1 - selection.x0 + 1, h: selection.y1 - selection.y0 + 1 })}
        </span>
      )}
    </div>
  );
}
