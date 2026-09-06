import { useEffect } from 'react';
import type { PixelEditorEngine } from '@/hooks/usePixelEditor';
import { useLanguage } from '@/lib/i18n';
import type { SpriteType } from '@/lib/types';
import { CanvasMetaBar } from './CanvasMetaBar';
import { CanvasStatusBar } from './CanvasStatusBar';
import { ColorPalette } from './ColorPalette';
import { FrameStrip } from './FrameStrip';
import { LayerPanel } from './LayerPanel';
import { OnionSkinPanel } from './OnionSkinPanel';
import { PixelCanvas } from './PixelCanvas';
import { PreviewPanel } from './PreviewPanel';
import { SidePanelSection } from './SidePanelSection';
import { SpriteLibrary } from './SpriteLibrary';
import { ToolOptionsBar } from './ToolOptionsBar';
import { ToolRail } from './ToolRail';
import { TransformPanel } from './TransformPanel';

export function PixelEditorPanel({
  engine,
  name,
  setName,
  type,
  setType,
  active,
}: {
  engine: PixelEditorEngine;
  name: string;
  setName: (name: string) => void;
  type: SpriteType;
  setType: (type: SpriteType) => void;
  active: boolean;
}) {
  const { t } = useLanguage();

  useEffect(() => {
    engine.setActive(active);
  }, [engine, active]);

  const confirmDiscard = () => confirm(t('confirm.discard'));
  const onError = (msg: string) => alert(msg);

  return (
    <div>
      <div className="editor-shell">
        <div className="left-rail">
          <ToolRail engine={engine} />
          <ColorPalette engine={engine} />
        </div>

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
          <SpriteLibrary engine={engine} onConfirmDiscard={confirmDiscard} onError={onError} />
        </div>

        {/* Layers is deliberately not collapsible: it's the panel in constant use, and it owns its own
            header with an add button. The three above it are set-and-forget, which is exactly what
            makes them worth folding away on a short window. */}
        <div className="side-panel">
          <SidePanelSection id="preview" title={t('preview.title')}>
            <PreviewPanel engine={engine} type={type} />
          </SidePanelSection>
          <SidePanelSection id="onion" title={t('onion.title')}>
            <OnionSkinPanel engine={engine} />
          </SidePanelSection>
          <SidePanelSection id="transform" title={t('transform.title')}>
            <TransformPanel engine={engine} />
          </SidePanelSection>
          <LayerPanel engine={engine} onError={onError} />
        </div>
      </div>
    </div>
  );
}
