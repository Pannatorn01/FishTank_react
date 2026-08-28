import { Button } from '@/components/ui/8bit/button';
import type { PixelEditorEngine } from '@/hooks/usePixelEditor';
import type { ToolName } from '@/lib/types';

const TOOLS: { tool: ToolName; icon: string; title: string }[] = [
  { tool: 'pen', icon: 'pen', title: 'ปากกา (B)' },
  { tool: 'line', icon: 'slash', title: 'เส้นตรง (L)' },
  { tool: 'fill', icon: 'fill-drip', title: 'เทสี (G)' },
  { tool: 'eyedropper', icon: 'eye-dropper', title: 'ดูดสี (I)' },
  { tool: 'eraser', icon: 'eraser', title: 'ยางลบ (E)' },
  { tool: 'rect', icon: 'square', title: 'สี่เหลี่ยม (R)' },
  { tool: 'ellipse', icon: 'circle', title: 'วงรี (C)' },
  { tool: 'select', icon: 'vector-square', title: 'เลือกพื้นที่ (S)' },
  { tool: 'move', icon: 'up-down-left-right', title: 'ย้ายพื้นที่ (M)' },
];

export function ToolRail({ engine }: { engine: PixelEditorEngine }) {
  return (
    <div className="tool-grid">
      {TOOLS.map(({ tool, icon, title }) => (
        <Button
          key={tool}
          type="button"
          size="icon"
          variant={engine.tool === tool ? 'default' : 'secondary'}
          title={title}
          onClick={() => engine.setTool(tool)}
        >
          <i className={`fa-solid fa-${icon}`} />
        </Button>
      ))}
      <Button type="button" size="icon" variant="secondary" title="ย้อนกลับ (Ctrl+Z)" disabled={!engine.canUndo()} onClick={() => engine.undo()}>
        <i className="fa-solid fa-arrow-rotate-left" />
      </Button>
      <Button type="button" size="icon" variant="secondary" title="ทำซ้ำ (Ctrl+Y)" disabled={!engine.canRedo()} onClick={() => engine.redo()}>
        <i className="fa-solid fa-arrow-rotate-right" />
      </Button>
      <div className="current-color-indicator" title="สีปัจจุบัน">
        <span className="color-chip" style={{ background: engine.color }} />
      </div>
    </div>
  );
}
