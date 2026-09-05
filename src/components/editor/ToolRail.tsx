import { Button } from '@/components/ui/button';
import type { PixelEditorEngine } from '@/hooks/usePixelEditor';
import { useLanguage } from '@/lib/i18n';
import type { ToolName } from '@/lib/types';

/** Tools grouped by what they do, each its own small grid - draw/paint tools, then shape tools, then
 *  selection tools - rather than one flat 13-button block, so related tools sit next to each other and
 *  the whole rail reads as three quick decisions instead of one long scan. */
const TOOL_GROUPS: { labelKey: string; tools: { tool: ToolName; icon: string }[] }[] = [
  {
    labelKey: 'tool.group.draw',
    tools: [
      { tool: 'pen', icon: 'pen' },
      { tool: 'eraser', icon: 'eraser' },
      { tool: 'line', icon: 'slash' },
      { tool: 'curve', icon: 'bezier-curve' },
      { tool: 'fill', icon: 'fill-drip' },
      { tool: 'eyedropper', icon: 'eye-dropper' },
      { tool: 'spray', icon: 'spray-can' },
      { tool: 'gradient', icon: 'circle-half-stroke' },
    ],
  },
  {
    labelKey: 'tool.group.shapes',
    tools: [
      { tool: 'rect', icon: 'square' },
      { tool: 'ellipse', icon: 'circle' },
    ],
  },
  {
    labelKey: 'tool.group.selection',
    tools: [
      { tool: 'select', icon: 'vector-square' },
      { tool: 'lasso', icon: 'draw-polygon' },
      { tool: 'move', icon: 'up-down-left-right' },
    ],
  },
];

export function ToolRail({ engine }: { engine: PixelEditorEngine }) {
  const { t } = useLanguage();
  return (
    <>
      {TOOL_GROUPS.map(({ labelKey, tools }) => (
        <div key={labelKey} className="tool-group">
          <div className="tool-group-label">{t(labelKey)}</div>
          <div className="tool-grid">
            {tools.map(({ tool, icon }) => (
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
        </div>
      ))}
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
