import { useRef, useState } from 'react';
import { PixelThumb } from '@/components/PixelThumb';
import type { PixelEditorEngine } from '@/hooks/usePixelEditor';
import { useLanguage } from '@/lib/i18n';
import { paintFrameCells } from '@/lib/pixelMath';
import type { Layer } from '@/lib/types';

/** File extensions accepted by the "Import image as layer" input - matches what pixelateImageFile
 *  (lib/imageImport.ts) can decode via the browser's own <img> element. */
const IMPORT_IMAGE_ACCEPT = 'image/*';

const THUMB_PX = 26;

function LayerThumb({ layer, width, height }: { layer: Layer; width: number; height: number }) {
  // paintFrameCells, not paintLayers: a hidden or fully transparent layer still has to show its
  // contents here, or the list would have nothing to identify the layer you are about to unhide. No
  // `deps` either - the engine paints into these cells in place.
  return (
    <PixelThumb
      size={THUMB_PX}
      width={width}
      height={height}
      className="layer-thumb"
      paint={(ctx, cellPx) => paintFrameCells(ctx, layer.cells, width, height, cellPx)}
    />
  );
}

/** `showTitle` is false when the panel is docked (see PixelEditorPanel): the dock's own header already
 *  names it, so this row keeps only its add/import buttons rather than repeating the word twice. */
export function LayerPanel({
  engine,
  onError,
  showTitle = true,
}: {
  engine: PixelEditorEngine;
  onError: (msg: string) => void;
  showTitle?: boolean;
}) {
  const { t } = useLanguage();
  const { width, height } = engine.current;
  const layers = engine.current.frames[engine.frameIndex];
  const limitReached = engine.layerLimitReached();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [opacityOpenId, setOpacityOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const grabbedHandleRef = useRef(false);
  const importImageInputRef = useRef<HTMLInputElement>(null);

  const endDrag = () => {
    setDragIndex(null);
    setOverIndex(null);
  };

  const commitRename = (index: number) => {
    engine.renameLayer(index, draftName);
    setRenamingId(null);
  };

  const rows = layers.map((layer, index) => ({ layer, index })).reverse();

  return (
    <div className="layer-panel flex-1">
      <div className="panel-title" data-actions-only={!showTitle || undefined}>
        {showTitle && t('layer.title')}
        <span className="panel-title-actions">
          <button
            type="button"
            className="panel-title-add"
            title={t('layer.importImageTitle')}
            disabled={limitReached}
            onClick={() => importImageInputRef.current?.click()}
          >
            <i className="fa-solid fa-file-import" />
          </button>
          <input
            ref={importImageInputRef}
            type="file"
            accept={IMPORT_IMAGE_ACCEPT}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) {
                engine.importImageAsLayer(file).catch((err) => {
                  console.error('importImageAsLayer failed', err);
                  onError(t('error.importFailed'));
                });
              }
            }}
          />
          <button
            type="button"
            className="panel-title-add"
            title={t('layer.add')}
            disabled={limitReached}
            onClick={() => engine.addLayer()}
          >
            <i className="fa-solid fa-plus" />
          </button>
        </span>
      </div>
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
              {renamingId === layer.id ? (
                <input
                  className="layer-name-input"
                  value={draftName}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={() => commitRename(index)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(index);
                    else if (e.key === 'Escape') setRenamingId(null);
                  }}
                />
              ) : (
                <span
                  className="layer-name"
                  title={t('layer.rename')}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setDraftName(layer.name);
                    setRenamingId(layer.id);
                  }}
                >
                  {layer.name}
                </span>
              )}
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
                className="layer-copy-all-frames"
                title={t('layer.copyToAllFrames')}
                disabled={engine.current.frames.length <= 1}
                onClick={(e) => {
                  e.stopPropagation();
                  engine.copyLayerToAllFrames(index);
                }}
              >
                <i className="fa-solid fa-copy" />
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
                className="layer-dup"
                title={t('layer.duplicate')}
                disabled={limitReached}
                onClick={(e) => {
                  e.stopPropagation();
                  engine.duplicateLayer(index);
                }}
              >
                <i className="fa-solid fa-clone" />
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
                <i className="fa-solid fa-trash" />
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
    </div>
  );
}
