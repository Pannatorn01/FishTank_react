import { Button } from '@/components/ui/button';
import type { PixelEditorEngine } from '@/hooks/usePixelEditor';
import { useLanguage } from '@/lib/i18n';
import type { ToolName } from '@/lib/types';

const TOOLS: { tool: ToolName; icon: string }[] = [
  { tool: 'pen', icon: 'pen' },
  { tool: 'line', icon: 'slash' },
  { tool: 'curve', icon: 'bezier-curve' },
  { tool: 'fill', icon: 'fill-drip' },
  { tool: 'eyedropper', icon: 'eye-dropper' },
  { tool: 'eraser', icon: 'eraser' },
  { tool: 'spray', icon: 'spray-can' },
  { tool: 'gradient', icon: 'circle-half-stroke' },
  { tool: 'rect', icon: 'square' },
  { tool: 'ellipse', icon: 'circle' },
  { tool: 'select', icon: 'vector-square' },
  { tool: 'move', icon: 'up-down-left-right' },
];

export function ToolRail({ engine }: { engine: PixelEditorEngine }) {
  const { t } = useLanguage();
  return (
    <>
      <div className="tool-grid">
        {TOOLS.map(({ tool, icon }) => (
          <Button
            key={tool}
            type="button"
            size="icon"
            variant={engine.tool === tool ? 'default' : 'secondary'}
            title={t(`tool.${tool}.desc`)}
            onClick={() => engine.setTool(tool)}
          >
            <i className={`fa-solid fa-${icon}`} />
          </Button>
        ))}
      </div>
      <div className="tool-actions">
        <Button type="button" size="icon" variant="secondary" title={t('action.undo')} disabled={!engine.canUndo()} onClick={() => engine.undo()}>
          <i className="fa-solid fa-arrow-rotate-left w-100" />
        </Button>
        <Button type="button" size="icon" variant="secondary" title={t('action.redo')} disabled={!engine.canRedo()} onClick={() => engine.redo()}>
          <i className="fa-solid fa-arrow-rotate-right w-100" />
        </Button>
      </div>
    </>
  );
}
