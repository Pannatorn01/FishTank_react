import { Button } from '@/components/ui/8bit/button';
import { Checkbox } from '@/components/ui/8bit/checkbox';
import { Label } from '@/components/ui/8bit/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/8bit/select';
import { ZOOM_LEVELS } from '@/hooks/usePixelEditor';
import type { PixelEditorEngine } from '@/hooks/usePixelEditor';
import { GRID_SIZES } from '@/lib/storage';
import type { SymmetryMode } from '@/lib/types';

const SYMMETRY_LABELS: Record<SymmetryMode, string> = {
  none: 'ไม่มีสมมาตร',
  vertical: 'สมมาตรแนวตั้ง',
  horizontal: 'สมมาตรแนวนอน',
  both: 'สมมาตรทั้งคู่',
};

export function CanvasStatusBar({ engine }: { engine: PixelEditorEngine }) {
  const showShapeFilled = engine.tool === 'rect' || engine.tool === 'ellipse';

  return (
    <div className="canvas-status-bar">
      <div className="zoom-controls">
        <Button type="button" size="icon" variant="secondary" title="ซูมออก" disabled={engine.zoomIndex === 0} onClick={() => engine.zoomOut()}>
          <i className="fa-solid fa-magnifying-glass-minus" />
        </Button>
        <span id="zoom-label">{engine.zoomLabel()}</span>
        <Button
          type="button"
          size="icon"
          variant="secondary"
          title="ซูมเข้า"
          disabled={engine.zoomIndex === ZOOM_LEVELS.length - 1}
          onClick={() => engine.zoomIn()}
        >
          <i className="fa-solid fa-magnifying-glass-plus" />
        </Button>
      </div>

      <Select value={String(engine.current.size)} onValueChange={(v) => engine.setGridSize(Number(v))}>
        <SelectTrigger className="w-28 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {GRID_SIZES.map((size) => (
            <SelectItem key={size} value={String(size)}>
              {size}×{size}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <label className="mini-toggle">
        <Checkbox checked={engine.showGrid} onCheckedChange={(v) => engine.setShowGrid(!!v)} />
        <Label>เส้นกริด</Label>
      </label>

      {showShapeFilled && (
        <label className="mini-toggle">
          <Checkbox checked={engine.shapeFilled} onCheckedChange={(v) => engine.setShapeFilled(!!v)} />
          <Label>เติมสีเต็ม</Label>
        </label>
      )}

      <Select value={engine.symmetry} onValueChange={(v) => engine.setSymmetry(v as SymmetryMode)}>
        <SelectTrigger className="w-56 text-xs" title="วาดแบบสมมาตร (V)">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(SYMMETRY_LABELS) as SymmetryMode[]).map((mode) => (
            <SelectItem key={mode} value={mode}>
              {SYMMETRY_LABELS[mode]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
