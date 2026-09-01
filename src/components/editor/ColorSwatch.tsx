import { useLanguage } from '@/lib/i18n';

export function ColorSwatch({
  color,
  activeColor,
  onSelect,
  onRemove,
}: {
  color: string;
  activeColor: string;
  onSelect: (color: string) => void;
  onRemove: (color: string) => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="color-swatch-wrap">
      <button
        type="button"
        className={`swatch${activeColor === color ? ' active' : ''}`}
        style={{ background: color }}
        title={color}
        onClick={() => onSelect(color)}
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
