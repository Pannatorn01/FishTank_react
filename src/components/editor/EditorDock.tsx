import { useRef, useState, type ReactNode } from 'react';
import type { DockPanelId, DockZone } from '@/hooks/useEditorLayout';

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
 * handle - grab it and drop it on any of the three docks (see DockZoneView) to move the panel there,
 * or on another spot in the same dock to reorder. Collapsed bodies are unmounted rather than hidden,
 * since these panels do real work on render (the preview canvas, the layer thumbnails).
 */
export function DockPanel({
  id,
  title,
  icon,
  dragging,
  onDragStart,
  onDragEnd,
  children,
}: {
  id: DockPanelId;
  title: string;
  icon: string;
  dragging: boolean;
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
    <section className="dock-panel" data-panel-id={id} data-collapsed={collapsed || undefined} data-dragging={dragging || undefined}>
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
        <button
          type="button"
          className="dock-panel-collapse"
          onClick={toggle}
          aria-expanded={!collapsed}
          title={title}
        >
          <i className={`fa-solid ${collapsed ? 'fa-chevron-right' : 'fa-chevron-down'}`} aria-hidden="true" />
        </button>
      </div>
      {!collapsed && <div className="dock-panel-body">{children}</div>}
    </section>
  );
}

/**
 * One of the three docks. Doubles as the drop target for a panel drag: the insertion point is worked
 * out from where the pointer is relative to the panels already in it, so dropping between two panels
 * puts it between them rather than always at the end.
 */
export function DockZoneView({
  zone,
  size,
  dragging,
  onDropPanel,
  onResize,
  resizeLabel,
  emptyHint,
  children,
}: {
  zone: DockZone;
  size: number;
  dragging: DockPanelId | null;
  onDropPanel: (panel: DockPanelId, zone: DockZone, beforeId: DockPanelId | null) => void;
  onResize: (px: number) => void;
  resizeLabel: string;
  emptyHint: string;
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  const vertical = zone !== 'bottom';
  const axis = vertical ? 'x' : 'y';
  /** Which way the dock grows relative to pointer movement: the left dock widens as the pointer moves
   *  right, the right and bottom docks shrink. */
  const sign = zone === 'left' ? 1 : -1;
  const resizeStart = useRef<{ pos: number; size: number } | null>(null);

  const insertionBefore = (e: React.DragEvent<HTMLDivElement>): DockPanelId | null => {
    const panels = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-panel-id]'));
    const pos = vertical ? e.clientY : e.clientX;
    for (const el of panels) {
      const r = el.getBoundingClientRect();
      const mid = vertical ? r.top + r.height / 2 : r.left + r.width / 2;
      if (pos < mid) return (el.dataset.panelId as DockPanelId) ?? null;
    }
    return null;
  };

  const empty = !children || (Array.isArray(children) && children.length === 0);

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
        // Only when the pointer actually left this dock - dragging across a child fires dragleave for
        // the child, which would otherwise flicker the highlight off and on for the whole drag.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const panel = (e.dataTransfer.getData('application/x-fishtank-panel') || dragging) as DockPanelId | null;
        if (panel) onDropPanel(panel, zone, insertionBefore(e));
      }}
    >
      {/* The panels scroll inside this; the resize edge below sits outside it, so it can't be clipped
          or scrolled away by a dock with more in it than fits. */}
      <div className="dock-zone-scroll">
        {children}
        {dragging && <div className="dock-zone-hint">{emptyHint}</div>}
      </div>
      {!empty && (
        /* The dock's own inner edge is the resize handle - there is no bar between the canvas and the
           docks any more, just the gap that separates them. Grabbing the edge of the thing you want
           bigger is the same gesture, minus a strip of chrome down the middle of the workspace. */
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
