import { useEffect, useState, type ReactNode } from 'react';
import type { PixelEditorEngine } from '@/hooks/usePixelEditor';
import type { DockPanelId, DockZone, EditorLayoutApi } from '@/hooks/useEditorLayout';
import { useLanguage } from '@/lib/i18n';
import type { SpriteType } from '@/lib/types';
import { CanvasMetaBar } from './CanvasMetaBar';
import { CanvasStatusBar } from './CanvasStatusBar';
import { ColorPalette } from './ColorPalette';
import { DockPanel, DockSplitter, DockZoneView } from './EditorDock';
import { FrameStrip } from './FrameStrip';
import { LayerPanel } from './LayerPanel';
import { OnionSkinPanel } from './OnionSkinPanel';
import { PixelCanvas } from './PixelCanvas';
import { PreviewPanel } from './PreviewPanel';
import { SpriteLibrary } from './SpriteLibrary';
import { ToolOptionsBar } from './ToolOptionsBar';
import { ToolRail } from './ToolRail';
import { TransformPanel } from './TransformPanel';

/** Header label and icon for each dockable panel - the panel's own contents are built below, where
 *  they have the props they need. */
const PANEL_META: Record<DockPanelId, { titleKey: string; icon: string }> = {
  tools: { titleKey: 'dock.tools', icon: 'toolbox' },
  palette: { titleKey: 'dock.palette', icon: 'palette' },
  preview: { titleKey: 'preview.title', icon: 'eye' },
  onion: { titleKey: 'onion.title', icon: 'layer-group' },
  transform: { titleKey: 'transform.title', icon: 'arrows-rotate' },
  layers: { titleKey: 'layer.title', icon: 'clone' },
  library: { titleKey: 'library.title', icon: 'box-archive' },
};

/** The dock layout lives in App rather than here so the header can offer a "reset layout" button -
 *  the way back from an arrangement dragged into a corner - without threading a callback back up. */
export function PixelEditorPanel({
  engine,
  name,
  setName,
  type,
  setType,
  active,
  layoutApi,
}: {
  engine: PixelEditorEngine;
  name: string;
  setName: (name: string) => void;
  type: SpriteType;
  setType: (type: SpriteType) => void;
  active: boolean;
  layoutApi: EditorLayoutApi;
}) {
  const { t } = useLanguage();
  const { layout, movePanel, setZoneSize } = layoutApi;
  /** Which panel is mid-drag, so every dock can offer itself as a drop target while one is moving. */
  const [dragging, setDragging] = useState<DockPanelId | null>(null);

  useEffect(() => {
    engine.setActive(active);
  }, [engine, active]);

  // Safety net for the drag highlight. A panel's own dragend is not guaranteed to arrive - a drop
  // outside any dock, a drag cancelled with Esc, or a browser that skips it after a successful drop all
  // leave it unfired - and a stuck "something is being dragged" flag means every dock keeps offering
  // itself as a drop target long after the drag ended. Listening on the window catches all of those.
  useEffect(() => {
    if (!dragging) return;
    const clear = () => setDragging(null);
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    return () => {
      window.removeEventListener('dragend', clear);
      window.removeEventListener('drop', clear);
    };
  }, [dragging]);

  const confirmDiscard = () => confirm(t('confirm.discard'));
  const onError = (msg: string) => alert(msg);

  const panelBody: Record<DockPanelId, ReactNode> = {
    tools: <ToolRail engine={engine} />,
    palette: <ColorPalette engine={engine} />,
    preview: <PreviewPanel engine={engine} type={type} />,
    onion: <OnionSkinPanel engine={engine} />,
    transform: <TransformPanel engine={engine} />,
    layers: <LayerPanel engine={engine} onError={onError} showTitle={false} />,
    library: <SpriteLibrary engine={engine} onConfirmDiscard={confirmDiscard} onError={onError} />,
  };

  const renderZone = (zone: DockZone) => (
    <DockZoneView
      zone={zone}
      size={layout.sizes[zone]}
      dragging={dragging}
      onDropPanel={(panel, target, beforeId) => {
        movePanel(panel, target, beforeId);
        setDragging(null);
      }}
      emptyHint={t('dock.dropHere')}
    >
      {layout.zones[zone].map((id) => (
        <DockPanel
          key={id}
          id={id}
          title={t(PANEL_META[id].titleKey)}
          icon={PANEL_META[id].icon}
          dragging={dragging === id}
          onDragStart={setDragging}
          onDragEnd={() => setDragging(null)}
        >
          {panelBody[id]}
        </DockPanel>
      ))}
    </DockZoneView>
  );

  return (
    <div className="editor-shell" data-dock-dragging={dragging || undefined}>
      <div className="editor-main">
        {renderZone('left')}
        {layout.zones.left.length > 0 && (
          <DockSplitter axis="x" sign={1} size={layout.sizes.left} onResize={(px) => setZoneSize('left', px)} label={t('dock.resize')} />
        )}

        <div className="canvas-column">
          <CanvasMetaBar
            engine={engine}
            name={name}
            setName={setName}
            type={type}
            setType={setType}
            onError={onError}
            onConfirmDiscard={confirmDiscard}
          />
          <ToolOptionsBar engine={engine} />
          <PixelCanvas engine={engine} />
          <CanvasStatusBar engine={engine} type={type} />
          <FrameStrip engine={engine} type={type} />
        </div>

        {layout.zones.right.length > 0 && (
          <DockSplitter axis="x" sign={-1} size={layout.sizes.right} onResize={(px) => setZoneSize('right', px)} label={t('dock.resize')} />
        )}
        {renderZone('right')}
      </div>

      {layout.zones.bottom.length > 0 && (
        <DockSplitter axis="y" sign={-1} size={layout.sizes.bottom} onResize={(px) => setZoneSize('bottom', px)} label={t('dock.resize')} />
      )}
      {renderZone('bottom')}
    </div>
  );
}
