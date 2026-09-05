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
import { BRUSH_SIZE_TOOLS, MAX_BRUSH_SIZE, ZOOM_LEVELS } from '@/hooks/usePixelEditor';
import type { PixelEditorEngine } from '@/hooks/usePixelEditor';
import { useLanguage } from '@/lib/i18n';
import { GRID_SIZES, MAX_BACKGROUND_GRID_SIZE, MAX_GRID_SIZE, MIN_BACKGROUND_GRID_SIZE, MIN_GRID_SIZE } from '@/lib/storage';
import type { CanvasBackground, SpriteType, SymmetryMode } from '@/lib/types';

const CUSTOM_SIZE_VALUE = 'custom';

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

function clampGridSize(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function CanvasStatusBar({ engine, type }: { engine: PixelEditorEngine; type: SpriteType }) {
  const { t } = useLanguage();
  const showShapeFilled = engine.tool === 'rect' || engine.tool === 'ellipse';
  // Single source of truth (BRUSH_SIZE_TOOLS) shared with the engine's own brushSizeToolKey()/
  // brushPreviewRect() gating - this used to be its own hardcoded tool list here, which silently fell
  // out of sync with the engine's list when line/rect/ellipse were added to it (the UI kept hiding the
  // control for tools that could otherwise use it).
  const showBrushOptions = BRUSH_SIZE_TOOLS.has(engine.tool);
  const selection = engine.selection;
  const { width, height } = engine.current;
  const [customOpen, setCustomOpen] = useState(false);
  const [customWidth, setCustomWidth] = useState('');
  const [customHeight, setCustomHeight] = useState('');
  // Raw text of the zoom % field while it's being edited - null the rest of the time, when the field
  // just mirrors engine.zoomScale directly. Needed so an in-progress edit (e.g. typing "1" on the way
  // to "150") isn't clobbered by the engine's own value on every keystroke's re-render.
  const [zoomInput, setZoomInput] = useState<string | null>(null);

  const applyZoomInput = (raw: string) => {
    const n = Number(raw);
    if (raw.trim() && Number.isFinite(n) && n > 0) engine.setZoom(n / 100);
    setZoomInput(null);
  };

  // A background is stretched to fill the whole tank, so it's allowed a much bigger custom canvas than
  // any other sprite kind (up to the tank's own max size - see MAX_BACKGROUND_GRID_SIZE) and, unlike
  // any other kind, has a floor too (see MIN_BACKGROUND_GRID_SIZE): a background stretched up from a
  // tiny canvas would look blocky at any zoom level a player would actually view the tank at. `type` is
  // this dropdown's own live value (see the doc comment on engine.setGridSize for why that's not
  // necessarily engine.current.type), so switching it to "Background" applies the floor immediately,
  // before ever saving.
  const minW = type === 'background' ? MIN_BACKGROUND_GRID_SIZE : MIN_GRID_SIZE;
  const minH = minW;
  const maxW = type === 'background' ? MAX_BACKGROUND_GRID_SIZE.width : MAX_GRID_SIZE;
  const maxH = type === 'background' ? MAX_BACKGROUND_GRID_SIZE.height : MAX_GRID_SIZE;

  const confirmCustomSize = (e?: { preventDefault: () => void }) => {
    const w = Number(customWidth);
    const h = Number(customHeight);
    if (!customWidth.trim() || !customHeight.trim() || !Number.isFinite(w) || !Number.isFinite(h)) {
      e?.preventDefault();
      return;
    }
    engine.setGridSize(clampGridSize(w, minW, maxW), clampGridSize(h, minH, maxH), type);
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
          disabled={engine.zoomScale <= engine.minZoomScale()}
          onClick={() => engine.zoomOut()}
        >
          <i className="fa-solid fa-magnifying-glass-minus" />
        </Button>
        <Input
          type="number"
          min={Math.round(engine.minZoomScale() * 100)}
          max={Math.round(engine.maxZoomScale() * 100)}
          value={zoomInput ?? String(Math.round(engine.zoomScale * 100))}
          onChange={(e) => setZoomInput(e.target.value)}
          onBlur={(e) => applyZoomInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applyZoomInput(e.currentTarget.value);
            if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
          }}
          className="w-14 h-7 px-1 text-center text-xs"
          id="zoom-label"
          title={t('status.zoomTypeHint')}
          aria-label={t('status.zoomTypeHint')}
        />
        <span className="zoom-unit" aria-hidden="true">%</span>
        <Button
          type="button"
          size="icon"
          variant="secondary"
          title={t('status.zoomIn')}
          disabled={engine.zoomScale >= engine.maxZoomScale()}
          onClick={() => engine.zoomIn()}
        >
          <i className="fa-solid fa-magnifying-glass-plus" />
        </Button>
        <Button type="button" size="icon" variant="secondary" title={t('status.zoomFit')} onClick={() => engine.zoomToFit()}>
          <i className="fa-solid fa-expand" />
        </Button>
        <Select onValueChange={(v) => engine.setZoom(Number(v))}>
          <SelectTrigger className="w-7 px-1" title={t('status.zoomPresetsTitle')}>
            <i className="fa-solid fa-list" />
          </SelectTrigger>
          <SelectContent>
            {ZOOM_LEVELS.map((level) => (
              <SelectItem key={level} value={String(level)}>
                {Math.round(level * 100)}%
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
          engine.setGridSize(w, h, type);
        }}
      >
        <SelectTrigger className="w-28 text-xs" title={t('status.gridSizeTitle')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {GRID_SIZES.filter((size) => size >= minW).map((size) => (
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
              {type === 'background'
                ? t('status.gridCustomDescBackground', { min: minW, maxW, maxH })
                : t('status.gridCustomDesc', { min: minW, max: maxW })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="custom-grid-width">{t('status.gridWidthLabel')}</Label>
              <Input
                id="custom-grid-width"
                type="number"
                min={minW}
                max={maxW}
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
                min={minH}
                max={maxH}
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
