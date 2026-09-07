import { useCallback, useEffect, type ReactNode } from 'react';
import { useDockDrag, type DockDropLocation } from '@/hooks/useDockDrag';
import type { PixelEditorEngine } from '@/hooks/usePixelEditor';
import type { DockPanelId, DockZone, EditorLayoutApi } from '@/hooks/useEditorLayout';
import { useLanguage } from '@/lib/i18n';
import type { SpriteType } from '@/lib/types';
import { CanvasMetaBar } from './CanvasMetaBar';
import { CanvasStatusBar } from './CanvasStatusBar';
import { ColorPalette } from './ColorPalette';
import { DockDragGhost, DockPanel, DockZoneView } from './EditorDock';
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
  const { layout, movePanel, setZoneSize, setPanelHeight, setColumnWidth } = layoutApi;
  const onDrop = useCallback(
    (panel: DockPanelId, location: DockDropLocation) => movePanel(panel, location.zone, location.target),
    [movePanel]
  );
  // Plain pointer events, not native HTML5 drag-and-drop - see useDockDrag.ts for why (short version: a
  // scripted mouse-drag testing the old native version hung the browser's own input queue mid-gesture,
  // which is the same OS-level handoff that made a real drag sometimes just not start for a real user).
  const { dragging, dropLocation, ghostRef, onDragStart, onDragMove, onDragEnd, onDragCancel } = useDockDrag(onDrop);

  useEffect(() => {
    engine.setActive(active);
  }, [engine, active]);

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

  const renderPanel = (id: DockPanelId) => (
    <DockPanel
      key={id}
      id={id}
      title={t(PANEL_META[id].titleKey)}
      icon={PANEL_META[id].icon}
      dragging={dragging === id}
      height={layout.panelHeights[id]}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      {panelBody[id]}
    </DockPanel>
  );

  const renderZone = (zone: DockZone) => (
    <DockZoneView
      zone={zone}
      size={layout.sizes[zone]}
      columns={layout.zones[zone]}
      columnWidths={layout.columnWidths}
      dragging={dragging}
      dropLocation={dropLocation}
      onResize={(px) => setZoneSize(zone, px)}
      onPanelResize={setPanelHeight}
      onColumnResize={setColumnWidth}
      renderPanel={renderPanel}
      resizeLabel={t('dock.resize')}
      panelResizeLabel={t('dock.resizePanel')}
      columnResizeLabel={t('dock.resizeColumn')}
      newColumnLabel={t('dock.newColumn')}
      emptyHint={t('dock.dropHere')}
    />
  );

  return (
    <div className="editor-shell" data-dock-dragging={dragging || undefined}>
      <DockDragGhost
        ghostRef={ghostRef}
        panel={dragging}
        title={dragging ? t(PANEL_META[dragging].titleKey) : ''}
        icon={dragging ? PANEL_META[dragging].icon : ''}
      />
      <div className="editor-main">
        {renderZone('left')}

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

        {renderZone('right')}
      </div>

      {renderZone('bottom')}
    </div>
  );
}
