import type { TankEngine } from '@/hooks/useTank';
import { useLanguage } from '@/lib/i18n';

export function TankCanvas({ engine }: { engine: TankEngine }) {
  const { t } = useLanguage();
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
      <div className="selection-toolbar" hidden={!engine.selectedId}>
        <button
          type="button"
          className="selection-toolbar-btn"
          title={t('tank.sendToBack')}
          onClick={() => engine.selectedId && engine.sendToBack(engine.selectedId)}
        >
          <i className="fa-solid fa-angles-down" />
        </button>
        <button
          type="button"
          className="selection-toolbar-btn"
          title={t('tank.bringToFront')}
          onClick={() => engine.selectedId && engine.bringToFront(engine.selectedId)}
        >
          <i className="fa-solid fa-angles-up" />
        </button>
        <button type="button" className="delete-selected-btn" onClick={() => engine.removeSelected()}>
          <i className="fa-solid fa-trash" /> {t('tank.deleteSelected')}
        </button>
      </div>
    </div>
  );
}
