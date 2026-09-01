import { useState } from 'react';
import type { PixelEditorEngine } from '@/hooks/usePixelEditor';
import { useLanguage } from '@/lib/i18n';
import { ColorPicker } from './ColorPicker';
import { ColorSwatch } from './ColorSwatch';

export function ColorPalette({ engine }: { engine: PixelEditorEngine }) {
  const { t } = useLanguage();
  const isGradient = engine.tool === 'gradient';
  const [pickerTarget, setPickerTarget] = useState<'start' | 'end'>('start');
  const target = isGradient ? pickerTarget : 'start';
  const value = target === 'start' ? engine.color : engine.gradientColor;
  const onChange = (hex: string) => (target === 'start' ? engine.setColor(hex) : engine.setGradientColor(hex));

  return (
    <div className="palette-panel flex-1">
      {isGradient && (
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
            onClick={() => {
              const start = engine.color;
              engine.setColor(engine.gradientColor);
              engine.setGradientColor(start);
            }}
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
      <div className="palette">
        {engine.paletteColors.map((c) => (
          <ColorSwatch
            key={`p-${c}`}
            color={c}
            activeColor={value}
            onSelect={onChange}
            onRemove={(color) => engine.removePaletteColor(color)}
          />
        ))}
        {engine.savedColors.map((c) => (
          <ColorSwatch
            key={`s-${c}`}
            color={c}
            activeColor={value}
            onSelect={onChange}
            onRemove={(color) => engine.removeSavedColor(color)}
          />
        ))}
        <button type="button" className="swatch-add" title={t('palette.addColor')} onClick={() => engine.addSavedColor(value)}>
          <i className="fa-solid fa-plus" />
        </button>
      </div>
    </div>
  );
}
