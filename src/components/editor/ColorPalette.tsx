import { useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PRESET_PALETTES, type PixelEditorEngine } from '@/hooks/usePixelEditor';
import { useLanguage } from '@/lib/i18n';
import { ColorPicker } from './ColorPicker';
import { ColorSwatch } from './ColorSwatch';

const PRESET_LABEL_KEYS: Record<string, string> = {
  reef: 'palette.presetReef',
  deepSea: 'palette.presetDeepSea',
};

export function ColorPalette({ engine }: { engine: PixelEditorEngine }) {
  const { t } = useLanguage();
  const isGradient = engine.tool === 'gradient';
  // The dither brush uses `gradientColor` as its second color for every tool, not just Gradient (see
  // ditherEnabled in usePixelEditor.ts), so the swatch pair that lets a user see/pick it needs to show
  // up whenever dither is on, not only while the Gradient tool is active.
  const showTargetToggle = isGradient || engine.ditherEnabled;
  const [pickerTarget, setPickerTarget] = useState<'start' | 'end'>('start');
  const target = showTargetToggle ? pickerTarget : 'start';
  const value = target === 'start' ? engine.color : engine.gradientColor;
  const onChange = (hex: string) => (target === 'start' ? engine.setColor(hex) : engine.setGradientColor(hex));
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const endDrag = () => {
    setDragIndex(null);
    setOverIndex(null);
  };

  return (
    <div className="palette-panel flex-1">
      {showTargetToggle && (
        <div className="gradient-target-toggle">
          <button
            type="button"
            className={`gradient-target-swatch${target === 'start' ? ' active' : ''}`}
            style={{ background: engine.color }}
            title={t('palette.gradientStart')}
            onClick={() => setPickerTarget('start')}
          />
          <button
            type="button"
            className="gradient-target-swap"
            title={t('palette.gradientSwap')}
            onClick={() => engine.swapColors()}
          >
            <i className="fa-solid fa-arrow-right-arrow-left" />
          </button>
          <button
            type="button"
            className={`gradient-target-swatch${target === 'end' ? ' active' : ''}`}
            style={{ background: engine.gradientColor }}
            title={t('palette.gradientEnd')}
            onClick={() => setPickerTarget('end')}
          />
        </div>
      )}
      <ColorPicker value={value} onChange={onChange} />
      <div className="palette-presets">
        <Select onValueChange={(v) => engine.applyPresetPalette(v)}>
          <SelectTrigger className="w-full text-xs" title={t('palette.presetsTitle')}>
            <SelectValue placeholder={t('palette.presetsTitle')} />
          </SelectTrigger>
          <SelectContent>
            {Object.keys(PRESET_PALETTES).map((name) => (
              <SelectItem key={name} value={name}>
                {t(PRESET_LABEL_KEYS[name] ?? name)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="palette builtin-palette">
        {engine.paletteColors.map((c) => (
          <ColorSwatch
            key={`p-${c}`}
            color={c}
            activeColor={value}
            onSelect={onChange}
            onRemove={(color) => engine.removePaletteColor(color)}
          />
        ))}
      </div>
      <div className="palette saved-palette">
        {engine.savedColors.map((c, index) => (
          <ColorSwatch
            key={`s-${c}`}
            color={c}
            activeColor={value}
            onSelect={onChange}
            onRemove={(color) => engine.removeSavedColor(color)}
            pinned={engine.isPinnedColor(c)}
            onTogglePin={(color) => engine.togglePinColor(color)}
            draggable
            dragOver={overIndex === index && dragIndex !== null && dragIndex !== index}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              setDragIndex(index);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (overIndex !== index) setOverIndex(index);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex !== null && dragIndex !== index) engine.reorderSavedColor(dragIndex, index);
              endDrag();
            }}
            onDragEnd={endDrag}
          />
        ))}
        <button type="button" className="swatch-add" title={t('palette.addColor')} onClick={() => engine.addSavedColor(value)}>
          <i className="fa-solid fa-plus" />
        </button>
        {engine.savedColors.length > 0 && (
          <button
            type="button"
            className="swatch-clear-unused"
            title={t('palette.clearUnusedTitle')}
            onClick={() => engine.clearUnusedColors()}
          >
            <i className="fa-solid fa-broom" /> {t('palette.clearUnused')}
          </button>
        )}
      </div>
    </div>
  );
}
