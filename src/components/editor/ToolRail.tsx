import { Button } from '@/components/ui/button';
import type { PixelEditorEngine } from '@/hooks/usePixelEditor';
import { useLanguage } from '@/lib/i18n';
import type { ToolName } from '@/lib/types';

/**
 * Every tool, always visible - no press-and-hold flyouts. The rail used to group Line/Curve,
 * Rect/Ellipse, Fill/Gradient and the three selection tools behind four buttons that only revealed
 * their contents after a 380ms hold, which meant half the toolbox was invisible until you already knew
 * it was there. The buttons themselves are laid out by CSS as an auto-filling grid (see .tool-rail-icons),
 * so the same flat list is one narrow column in a slim dock and several columns in a wide or
 * bottom-docked one, rather than a fixed shape that only fits one place.
 *
 * Dividers keep the old clusters readable: draw / shape / selection.
 */
type RailEntry = { kind: 'tool'; tool: ToolName; icon: string } | { kind: 'divider' };

const RAIL_ENTRIES: RailEntry[] = [
  { kind: 'tool', tool: 'pen', icon: 'pen' },
  { kind: 'tool', tool: 'eraser', icon: 'eraser' },
  { kind: 'tool', tool: 'line', icon: 'slash' },
  { kind: 'tool', tool: 'curve', icon: 'bezier-curve' },
  { kind: 'tool', tool: 'fill', icon: 'fill-drip' },
  { kind: 'tool', tool: 'gradient', icon: 'circle-half-stroke' },
  { kind: 'tool', tool: 'eyedropper', icon: 'eye-dropper' },
  { kind: 'tool', tool: 'spray', icon: 'spray-can' },
  { kind: 'divider' },
  { kind: 'tool', tool: 'rect', icon: 'square' },
  { kind: 'tool', tool: 'ellipse', icon: 'circle' },
  { kind: 'divider' },
  { kind: 'tool', tool: 'select', icon: 'vector-square' },
  { kind: 'tool', tool: 'lasso', icon: 'draw-polygon' },
  { kind: 'tool', tool: 'magicWand', icon: 'wand-magic-sparkles' },
  { kind: 'tool', tool: 'move', icon: 'up-down-left-right' },
];

export function ToolRail({ engine }: { engine: PixelEditorEngine }) {
  const { t } = useLanguage();

  return (
    <>
      <div className="tool-rail">
        <div className="tool-rail-icons">
          {RAIL_ENTRIES.map((entry, i) =>
            entry.kind === 'divider' ? (
              <div key={`div-${i}`} className="tool-divider" />
            ) : (
              <Button
                key={entry.tool}
                type="button"
                size="icon"
                variant={engine.tool === entry.tool ? 'default' : 'secondary'}
                title={t(`tool.${entry.tool}.desc`)}
                aria-label={t(`tool.${entry.tool}.short`)}
                aria-pressed={engine.tool === entry.tool}
                onClick={() => engine.setTool(entry.tool)}
              >
                <i className={`fa-solid fa-${entry.icon}`} />
              </Button>
            )
          )}
        </div>
      </div>
      <div className="tool-actions">
        <Button type="button" size="icon" variant="secondary" title={t('action.undo')} aria-label={t('action.undo')} disabled={!engine.canUndo()} onClick={() => engine.undo()}>
          <i className="fa-solid fa-arrow-rotate-left w-100" />
        </Button>
        <Button type="button" size="icon" variant="secondary" title={t('action.redo')} aria-label={t('action.redo')} disabled={!engine.canRedo()} onClick={() => engine.redo()}>
          <i className="fa-solid fa-arrow-rotate-right w-100" />
        </Button>
      </div>
    </>
  );
}
