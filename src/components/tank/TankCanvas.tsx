import type { TankEngine } from '@/hooks/useTank';

export function TankCanvas({ engine }: { engine: TankEngine }) {
  return (
    <div className="tank-wrap" ref={(el) => engine.attachWrap(el)}>
      <canvas
        ref={(el) => {
          engine.attachCanvas(el);
          if (el) engine.resizeCanvas();
        }}
        className="tank-canvas"
        onPointerDown={(e) => engine.onCanvasPointerDown(e)}
        onPointerMove={(e) => engine.onCanvasPointerMove(e)}
        onPointerUp={(e) => engine.onCanvasPointerUp(e)}
        onPointerCancel={(e) => engine.onCanvasPointerUp(e)}
      />
      <button
        type="button"
        ref={(el) => engine.attachTrash(el)}
        className={`trash-zone${engine.trashArmed ? ' armed' : ''}`}
        hidden={!engine.trashVisible}
      >
        <i className="fa-solid fa-trash" />
      </button>
      <button type="button" className="delete-selected-btn" hidden={!engine.selectedId} onClick={() => engine.removeSelected()}>
        <i className="fa-solid fa-trash" /> ลบตัวที่เลือก
      </button>
    </div>
  );
}
