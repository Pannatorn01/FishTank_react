import type React from 'react';
import { useLanguage } from '@/lib/i18n';

export function ColorSwatch({
  color,
  activeColor,
  onSelect,
  onRemove,
  pinned,
  onTogglePin,
  draggable,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  dragOver,
}: {
  color: string;
  activeColor: string;
  onSelect: (color: string) => void;
  onRemove: (color: string) => void;
  /** Only saved (not built-in palette) colors are pinnable/reorderable - see ColorPalette.tsx. */
  pinned?: boolean;
  onTogglePin?: (color: string) => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  dragOver?: boolean;
}) {
  const { t } = useLanguage();
  return (
    <div
      className={`color-swatch-wrap${dragOver ? ' drag-over' : ''}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      <button
        type="button"
        className={`swatch${activeColor === color ? ' active' : ''}`}
        style={{ background: color }}
        title={color}
        onClick={() => onSelect(color)}
      />
      {onTogglePin && (
        <button
          type="button"
          className={`color-swatch-pin${pinned ? ' pinned' : ''}`}
          title={pinned ? t('palette.unpinColor') : t('palette.pinColor')}
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin(color);
          }}
        >
          <i className="fa-solid fa-thumbtack" />
        </button>
      )}
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
