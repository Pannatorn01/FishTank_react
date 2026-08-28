import { Button } from '@/components/ui/8bit/button';
import { Checkbox } from '@/components/ui/8bit/checkbox';
import { Label } from '@/components/ui/8bit/label';
import type { PixelEditorEngine } from '@/hooks/usePixelEditor';

export function TransformPanel({ engine }: { engine: PixelEditorEngine }) {
  return (
    <div className="transform-panel">
      <span className="panel-title">Transform</span>
      <div className="transform-buttons">
        <Button type="button" size="icon" variant="secondary" title="พลิกแนวนอน" onClick={() => engine.flipH()}>
          <i className="fa-solid fa-left-right" />
        </Button>
        <Button type="button" size="icon" variant="secondary" title="พลิกแนวตั้ง" onClick={() => engine.flipV()}>
          <i className="fa-solid fa-up-down" />
        </Button>
        <Button type="button" size="icon" variant="secondary" title="หมุนทวนเข็ม" onClick={() => engine.rotateCCW()}>
          <i className="fa-solid fa-rotate-left" />
        </Button>
        <Button type="button" size="icon" variant="secondary" title="หมุนตามเข็ม" onClick={() => engine.rotateCW()}>
          <i className="fa-solid fa-rotate-right" />
        </Button>
      </div>
      <label className="mini-toggle">
        <Checkbox checked={engine.transformAllFrames} onCheckedChange={(v) => engine.setTransformAllFrames(!!v)} />
        <Label>ใช้กับทุกเฟรม</Label>
      </label>
    </div>
  );
}
