import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { PixelEditorEngine } from '@/hooks/usePixelEditor';
import { useLanguage } from '@/lib/i18n';

export function LayerPanel({ engine }: { engine: PixelEditorEngine }) {
  const { t } = useLanguage();
  const layers = engine.current.frames[engine.frameIndex];
  const limitReached = engine.layerLimitReached();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const endDrag = () => {
    setDragIndex(null);
    setOverIndex(null);
  };

  const rows = layers.map((layer, index) => ({ layer, index })).reverse();

  return (
    <div className="layer-panel">
      <div className="panel-title">{t('layer.title')}</div>
      <div className="layer-list">
        {rows.map(({ layer, index }) => (
          <div
            key={layer.id}
            className={[
              'layer-row',
              index === engine.activeLayerIndex && 'active',
              dragIndex === index && 'dragging',
              overIndex === index && dragIndex !== null && dragIndex !== index && 'drag-over',
            ].filter(Boolean).join(' ')}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              setDragIndex(index);
            }}
            onDragEnd={endDrag}
            onDragOver={(e) => {
              e.preventDefault();
              if (overIndex !== index) setOverIndex(index);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex !== null && dragIndex !== index) engine.moveLayer(dragIndex, index);
              endDrag();
            }}
            onClick={() => engine.selectLayer(index)}
          >
            <button
              type="button"
              className="layer-eye"
              title={t('layer.visible')}
              onClick={(e) => {
                e.stopPropagation();
                engine.setLayerVisible(index, !layer.visible);
              }}
            >
              <i className={`fa-solid ${layer.visible ? 'fa-eye' : 'fa-eye-slash'}`} />
            </button>
            <span className="layer-name">{layer.name}</span>
            <button
              type="button"
              className="layer-merge"
              title={t('layer.mergeDown')}
              disabled={index === 0}
              onClick={(e) => {
                e.stopPropagation();
                engine.mergeLayerDown(index);
              }}
            >
              <i className="fa-solid fa-angles-down" />
            </button>
            <button
              type="button"
              className="layer-del"
              title={t('layer.delete')}
              disabled={layers.length <= 1}
              onClick={(e) => {
                e.stopPropagation();
                engine.deleteLayer(index);
              }}
            >
              <i className="fa-solid fa-xmark" />
            </button>
            <input
              type="range"
              className="layer-opacity"
              title={t('layer.opacity')}
              min={0}
              max={1}
              step={0.05}
              value={layer.opacity}
              onPointerDown={(e) => {
                e.stopPropagation();
                engine.pushUndo();
              }}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => engine.setLayerOpacity(index, Number(e.target.value))}
            />
          </div>
        ))}
      </div>
      <Button type="button" size="sm" variant="secondary" disabled={limitReached} onClick={() => engine.addLayer()}>
        <i className="fa-solid fa-plus" /> {t('layer.add')}
      </Button>
    </div>
  );
}
