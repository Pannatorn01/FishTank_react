import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { PixelEditorEngine } from '@/hooks/usePixelEditor';
import { useLanguage } from '@/lib/i18n';
import { paintFrameCells } from '@/lib/pixelMath';
import type { Layer } from '@/lib/types';

const THUMB_PX = 26;

function LayerThumb({ layer, width, height }: { layer: Layer; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const cellPx = THUMB_PX / Math.max(width, height);
    ctx.save();
    ctx.translate((THUMB_PX - width * cellPx) / 2, (THUMB_PX - height * cellPx) / 2);
    paintFrameCells(ctx, layer.cells, width, height, cellPx);
    ctx.restore();
  });
  return <canvas ref={ref} width={THUMB_PX} height={THUMB_PX} className="layer-thumb pixelated" />;
}

export function LayerPanel({ engine }: { engine: PixelEditorEngine }) {
  const { t } = useLanguage();
  const { width, height } = engine.current;
  const layers = engine.current.frames[engine.frameIndex];
  const limitReached = engine.layerLimitReached();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [opacityOpenId, setOpacityOpenId] = useState<string | null>(null);
  const grabbedHandleRef = useRef(false);

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
            onMouseDown={(e) => {
              grabbedHandleRef.current = !!(e.target as HTMLElement).closest('.layer-drag-handle');
            }}
            onDragStart={(e) => {
              if (!grabbedHandleRef.current) {
                e.preventDefault();
                return;
              }
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
            <div className="layer-row-main">
              <span className="layer-drag-handle" title={t('layer.drag')}>
                <i className="fa-solid fa-grip-vertical" />
              </span>
              <LayerThumb layer={layer} width={width} height={height} />
              <span className="layer-name">{layer.name}</span>
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
            </div>
            <div className="layer-row-actions">
              <button
                type="button"
                className={`layer-opacity-btn${opacityOpenId === layer.id ? ' open' : ''}`}
                title={t('layer.opacity')}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpacityOpenId(opacityOpenId === layer.id ? null : layer.id);
                }}
              >
                {Math.round(layer.opacity * 100)}%
              </button>
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
            </div>
            {opacityOpenId === layer.id && (
              <input
                type="range"
                className="layer-opacity-slider"
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
            )}
          </div>
        ))}
      </div>
      <Button type="button" size="sm" variant="secondary" disabled={limitReached} onClick={() => engine.addLayer()}>
        <i className="fa-solid fa-plus" /> {t('layer.add')}
      </Button>
    </div>
  );
}
