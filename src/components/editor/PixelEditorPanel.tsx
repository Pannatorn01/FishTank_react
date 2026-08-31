import { useEffect } from 'react';
import { usePixelEditor } from '@/hooks/usePixelEditor';
import { useLanguage } from '@/lib/i18n';
import { CanvasStatusBar } from './CanvasStatusBar';
import { ColorPalette } from './ColorPalette';
import { FrameStrip } from './FrameStrip';
import { LayerPanel } from './LayerPanel';
import { PixelCanvas } from './PixelCanvas';
import { PreviewPanel } from './PreviewPanel';
import { SpriteLibrary } from './SpriteLibrary';
import { SpriteMetaForm } from './SpriteMetaForm';
import { ToolRail } from './ToolRail';
import { TransformPanel } from './TransformPanel';

export function PixelEditorPanel({ active }: { active: boolean }) {
  const engine = usePixelEditor();
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
          <LayerPanel engine={engine} />
          <ColorPalette engine={engine} />
        </div>

        <div className="canvas-column">
          <PixelCanvas engine={engine} />
          <CanvasStatusBar engine={engine} />
          <FrameStrip engine={engine} />
          <SpriteLibrary engine={engine} onConfirmDiscard={confirmDiscard} onError={onError} />
        </div>

        <div className="side-panel">
          <PreviewPanel engine={engine} />
          <TransformPanel engine={engine} />
          <SpriteMetaForm engine={engine} onConfirmDiscard={confirmDiscard} onError={onError} />
        </div>
      </div>
    </div>
  );
}
