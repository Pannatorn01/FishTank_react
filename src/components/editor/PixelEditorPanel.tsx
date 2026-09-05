import { useEffect } from 'react';
import type { PixelEditorEngine } from '@/hooks/usePixelEditor';
import { useLanguage } from '@/lib/i18n';
import type { SpriteType } from '@/lib/types';
import { CanvasMetaBar } from './CanvasMetaBar';
import { CanvasStatusBar } from './CanvasStatusBar';
import { ColorPalette } from './ColorPalette';
import { FrameStrip } from './FrameStrip';
import { LayerPanel } from './LayerPanel';
import { PixelCanvas } from './PixelCanvas';
import { PreviewPanel } from './PreviewPanel';
import { SpriteLibrary } from './SpriteLibrary';
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
          <CanvasMetaBar engine={engine} name={name} setName={setName} type={type} setType={setType} onError={onError} />
          <PixelCanvas engine={engine} />
          <CanvasStatusBar engine={engine} type={type} />
          <FrameStrip engine={engine} type={type} />
          <SpriteLibrary engine={engine} onConfirmDiscard={confirmDiscard} onError={onError} />
        </div>

        <div className="side-panel">
          <PreviewPanel engine={engine} />
          <TransformPanel engine={engine} />
          <LayerPanel engine={engine} />        
        </div>
      </div>
    </div>
  );
}
