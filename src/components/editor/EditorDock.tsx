import { Fragment, useRef, useState, type ReactNode } from 'react';
import type { DockColumns, DockDropTarget, DockPanelId, DockZone } from '@/hooks/useEditorLayout';

/** Shared with the old SidePanelSection so a collapse state set before this existed still applies. */
const COLLAPSE_PREFIX = 'fishtank.sidePanel.collapsed.';

function loadCollapsed(id: string): boolean {
  try {
    return localStorage.getItem(COLLAPSE_PREFIX + id) === '1';
  } catch {
    return false;
  }
}

/**
 * One docked panel: a draggable header plus a body that can be folded away. The header is the whole
 * handle - grab it and drop it on any dock, on any column of a dock, or on the strip between two
 * columns to open a new one. Collapsed bodies are unmounted rather than hidden, since these panels do
 * real work on render (the preview canvas, the layer thumbnails).
 *
 * `height` is set once the divider under the panel has been dragged (see PanelDivider); until then the
 * panel keeps whatever the stylesheet gives it - its content's height, or a share of the leftover space.
 */
export function DockPanel({
  id,
  title,
  icon,
  dragging,
  height,
  onDragStart,
  onDragEnd,
  children,
}: {
  id: DockPanelId;
  title: string;
  icon: string;
  dragging: boolean;
  height?: number;
  onDragStart: (id: DockPanelId) => void;
  onDragEnd: () => void;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(() => loadCollapsed(id));

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSE_PREFIX + id, next ? '1' : '0');
    } catch {
      // Not being able to remember the choice is no reason to refuse to make it.
    }
  };

  return (
    <section
      className="dock-panel"
      data-panel-id={id}
      data-collapsed={collapsed || undefined}
      data-dragging={dragging || undefined}
      // A collapsed panel is only its header, so a height set while it was open must not hold an empty
      // box open at that size.
      style={height && !collapsed ? { flex: `0 0 ${height}px` } : undefined}
    >
      <div
        className="dock-panel-header"
        draggable
        onDragStart={(e) => {
          // text/plain as well as the private type: some browsers refuse to start a drag without one,
          // and a stray drop onto a text field then pastes the panel's id rather than nothing at all.
          e.dataTransfer.setData('application/x-fishtank-panel', id);
          e.dataTransfer.setData('text/plain', id);
          e.dataTransfer.effectAllowed = 'move';
          onDragStart(id);
        }}
        onDragEnd={onDragEnd}
      >
        <i className={`fa-solid fa-${icon} dock-panel-icon`} aria-hidden="true" />
        <span className="dock-panel-title">{title}</span>
        <button type="button" className="dock-panel-collapse" onClick={toggle} aria-expanded={!collapsed} title={title}>
          <i className={`fa-solid ${collapsed ? 'fa-chevron-right' : 'fa-chevron-down'}`} aria-hidden="true" />
        </button>
      </div>
      {!collapsed && <div className="dock-panel-body">{children}</div>}
    </section>
  );
}

/**
 * The grab area between two stacked panels. Dragging it sets the height of the panel *above* it; the
 * one below simply takes what's left, which is what makes a single divider read as "move this line"
 * rather than "resize two things at once".
 */
function PanelDivider({
  panel,
  label,
  onResize,
}: {
  panel: DockPanelId;
  label: string;
  onResize: (panel: DockPanelId, px: number) => void;
}) {
  const start = useRef<{ y: number; height: number } | null>(null);

  /** The rendered height of the panel above, read from the DOM rather than tracked in state: until its
   *  first drag a panel has no stored height at all, only whatever layout gave it. */
  const heightAbove = (el: HTMLElement): number => {
    const prev = el.previousElementSibling as HTMLElement | null;
    return prev ? prev.getBoundingClientRect().height : 0;
  };

  return (
    <div
      className="dock-panel-divider"
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      title={label}
      tabIndex={0}
      onPointerDown={(e) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        e.preventDefault();
        start.current = { y: e.clientY, height: heightAbove(e.currentTarget) };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        onResize(panel, start.current.height + (e.clientY - start.current.y));
      }}
      onPointerUp={(e) => {
        start.current = null;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => {
        start.current = null;
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 24 : 8;
        const dir = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
        if (!dir) return;
        e.preventDefault();
        onResize(panel, heightAbove(e.currentTarget) + dir * step);
      }}
    />
  );
}

/** One column of a dock: panels stacked top to bottom, with a resize divider between each pair. */
function DockColumn({
  zone,
  index,
  panels,
  dragging,
  onDropPanel,
  onPanelResize,
  renderPanel,
  resizeLabel,
}: {
  zone: DockZone;
  index: number;
  panels: DockPanelId[];
  dragging: DockPanelId | null;
  onDropPanel: (panel: DockPanelId, zone: DockZone, target: DockDropTarget) => void;
  onPanelResize: (panel: DockPanelId, px: number) => void;
  renderPanel: (id: DockPanelId) => ReactNode;
  resizeLabel: string;
}) {
  const [over, setOver] = useState(false);

  /** Which panel the dragged one should land above, from where the pointer is relative to the panels
   *  already here - so dropping between two of them puts it between them, not always at the end. */
  const insertionBefore = (e: React.DragEvent<HTMLDivElement>): DockPanelId | null => {
    for (const el of Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-panel-id]'))) {
      const r = el.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) return (el.dataset.panelId as DockPanelId) ?? null;
    }
    return null;
  };

  return (
    <div
      className="dock-column"
      data-drop-active={over || undefined}
      onDragOver={(e) => {
        if (!dragging) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        if (!over) setOver(true);
      }}
      onDragLeave={(e) => {
        // Only when the pointer really left this column - crossing a child fires dragleave for the
        // child, which would otherwise flicker the highlight for the whole drag.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        const panel = (e.dataTransfer.getData('application/x-fishtank-panel') || dragging) as DockPanelId | null;
        if (panel) onDropPanel(panel, zone, { kind: 'column', index, beforeId: insertionBefore(e) });
      }}
    >
      {panels.map((id, i) => (
        <Fragment key={id}>
          {renderPanel(id)}
          {i < panels.length - 1 && <PanelDivider panel={id} label={resizeLabel} onResize={onPanelResize} />}
        </Fragment>
      ))}
    </div>
  );
}

/** The strip between (and either side of) a dock's columns: dropping a panel here opens a new column at
 *  that position. Only exists while a panel is being dragged. */
function NewColumnStrip({
  zone,
  index,
  dragging,
  onDropPanel,
  label,
}: {
  zone: DockZone;
  index: number;
  dragging: DockPanelId | null;
  onDropPanel: (panel: DockPanelId, zone: DockZone, target: DockDropTarget) => void;
  label: string;
}) {
  const [over, setOver] = useState(false);
  if (!dragging) return null;
  return (
    <div
      className="dock-new-column"
      data-drop-active={over || undefined}
      title={label}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        if (!over) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        const panel = (e.dataTransfer.getData('application/x-fishtank-panel') || dragging) as DockPanelId | null;
        if (panel) onDropPanel(panel, zone, { kind: 'new', index });
      }}
    >
      <i className="fa-solid fa-plus" aria-hidden="true" />
    </div>
  );
}

/**
 * One of the three docks: a row of columns, plus the edge you drag to resize the whole dock. The zone
 * itself is the fallback drop target - a drop that misses every column lands in the last one.
 */
export function DockZoneView({
  zone,
  size,
  columns,
  dragging,
  onDropPanel,
  onResize,
  onPanelResize,
  renderPanel,
  resizeLabel,
  panelResizeLabel,
  newColumnLabel,
  emptyHint,
}: {
  zone: DockZone;
  size: number;
  columns: DockColumns;
  dragging: DockPanelId | null;
  onDropPanel: (panel: DockPanelId, zone: DockZone, target: DockDropTarget) => void;
  onResize: (px: number) => void;
  onPanelResize: (panel: DockPanelId, px: number) => void;
  renderPanel: (id: DockPanelId) => ReactNode;
  resizeLabel: string;
  panelResizeLabel: string;
  newColumnLabel: string;
  emptyHint: string;
}) {
  const [over, setOver] = useState(false);
  const vertical = zone !== 'bottom';
  const axis = vertical ? 'x' : 'y';
  /** Which way the dock grows relative to pointer movement: the left dock widens as the pointer moves
   *  right, the right and bottom docks shrink. */
  const sign = zone === 'left' ? 1 : -1;
  const resizeStart = useRef<{ pos: number; size: number } | null>(null);
  const empty = columns.length === 0;

  return (
    <div
      className="dock-zone"
      data-zone={zone}
      data-empty={empty || undefined}
      data-drop-active={over || undefined}
      // An empty dock still has to be reachable, or a panel dragged out of it could never go back:
      // it keeps a thin strip that widens into a labelled drop target while a drag is in progress.
      style={vertical ? { width: empty && !dragging ? undefined : size } : { height: empty && !dragging ? undefined : size }}
      onDragOver={(e) => {
        if (!dragging) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (!over) setOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const panel = (e.dataTransfer.getData('application/x-fishtank-panel') || dragging) as DockPanelId | null;
        if (!panel) return;
        onDropPanel(panel, zone, empty ? { kind: 'new', index: 0 } : { kind: 'column', index: columns.length - 1, beforeId: null });
      }}
    >
      <div className="dock-zone-columns">
        <NewColumnStrip zone={zone} index={0} dragging={dragging} onDropPanel={onDropPanel} label={newColumnLabel} />
        {columns.map((panels, i) => (
          <Fragment key={panels.join('-') || i}>
            <DockColumn
              zone={zone}
              index={i}
              panels={panels}
              dragging={dragging}
              onDropPanel={onDropPanel}
              onPanelResize={onPanelResize}
              renderPanel={renderPanel}
              resizeLabel={panelResizeLabel}
            />
            <NewColumnStrip zone={zone} index={i + 1} dragging={dragging} onDropPanel={onDropPanel} label={newColumnLabel} />
          </Fragment>
        ))}
        {dragging && empty && <div className="dock-zone-hint">{emptyHint}</div>}
      </div>
      {!empty && (
        /* The dock's own inner edge is the resize handle - there is no bar between the canvas and the
           docks, just the gap that separates them. Grabbing the edge of the thing you want bigger is
           the same gesture, minus a strip of chrome down the middle of the workspace. */
        <div
          className="dock-resize-edge"
          data-axis={axis}
          role="separator"
          aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
          aria-label={resizeLabel}
          title={resizeLabel}
          tabIndex={0}
          onPointerDown={(e) => {
            if (e.button !== 0 && e.pointerType === 'mouse') return;
            e.preventDefault();
            resizeStart.current = { pos: axis === 'x' ? e.clientX : e.clientY, size };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!resizeStart.current) return;
            const delta = (axis === 'x' ? e.clientX : e.clientY) - resizeStart.current.pos;
            onResize(resizeStart.current.size + delta * sign);
          }}
          onPointerUp={(e) => {
            resizeStart.current = null;
            if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onPointerCancel={() => {
            resizeStart.current = null;
          }}
          onKeyDown={(e) => {
            // Arrow keys nudge the same edge, so a dock's size isn't reachable only by a precise drag.
            const step = e.shiftKey ? 24 : 8;
            const dir = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : 0;
            if (!dir) return;
            e.preventDefault();
            onResize(size + dir * step * sign);
          }}
        />
      )}
    </div>
  );
}
