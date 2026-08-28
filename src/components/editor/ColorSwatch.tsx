import type { PixelEditorEngine } from '@/hooks/usePixelEditor';
import { useLanguage } from '@/lib/i18n';

export function ColorSwatch({
  engine,
  color,
  onRemove,
}: {
  engine: PixelEditorEngine;
  color: string;
  onRemove: (color: string) => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="color-swatch-wrap">
      <button
        type="button"
        className={`swatch${engine.color === color ? ' active' : ''}`}
        style={{ background: color }}
        title={color}
        onClick={() => engine.setColor(color)}
      />
      <button
        type="button"
        className="color-swatch-del"
        title={t('palette.removeColor')}
        onClick={(e) => {
          e.stopPropagation();
          onRemove(color);
        }}
      >
        <i className="fa-solid fa-xmark" />
      </button>
    </div>
  );
}
