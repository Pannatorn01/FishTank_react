import type { PixelEditorEngine } from '@/hooks/usePixelEditor';
import { useLanguage } from '@/lib/i18n';
import { ColorPicker } from './ColorPicker';
import { ColorSwatch } from './ColorSwatch';

export function ColorPalette({ engine }: { engine: PixelEditorEngine }) {
  const { t } = useLanguage();
  return (
    <div className="palette-panel">
      <ColorPicker engine={engine} />
      <div className="palette">
        {engine.paletteColors.map((c) => (
          <ColorSwatch key={`p-${c}`} engine={engine} color={c} onRemove={(color) => engine.removePaletteColor(color)} />
        ))}
        {engine.savedColors.map((c) => (
          <ColorSwatch key={`s-${c}`} engine={engine} color={c} onRemove={(color) => engine.removeSavedColor(color)} />
        ))}
        <button type="button" className="swatch-add" title={t('palette.addColor')} onClick={() => engine.addSavedColor(engine.color)}>
          <i className="fa-solid fa-plus" />
        </button>
      </div>
    </div>
  );
}
