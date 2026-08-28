import { COLORS } from '@/hooks/usePixelEditor';
import type { PixelEditorEngine } from '@/hooks/usePixelEditor';

export function ColorPalette({ engine }: { engine: PixelEditorEngine }) {
  return (
    <div className="palette-panel">
      <div className="palette">
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className={`swatch${engine.color === c ? ' active' : ''}`}
            style={{ background: c }}
            onClick={() => engine.setColor(c)}
          />
        ))}
      </div>
      <label className="custom-color-label">
        สีกำหนดเอง
        <input type="color" value={engine.color} onChange={(e) => engine.setColor(e.target.value)} />
      </label>
    </div>
  );
}
