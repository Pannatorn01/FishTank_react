import { useCallback, useEffect, useRef, useState } from 'react';
import type { DockDropTarget, DockPanelId, DockZone } from './useEditorLayout';

/**
 * Panel dragging used to be the browser's native HTML5 drag-and-drop (`draggable`, `dragstart`/
 * `dragover`/`drop`). That API hands the gesture off to the OS's own drag loop once it recognizes one -
 * which is also why a scripted mouse-down-then-move sequence testing it would simply hang mid-gesture,
 * the input queue blocked waiting on a native drag session no synthetic event can drive. The same
 * handoff is what made it unreliable for real users too: which exact pixel of a `draggable` element
 * starts a drag (versus a text selection, versus nothing) is a browser/OS implementation detail this
 * app has no say in, so "I try to grab it and it just won't go" was always going to happen to someone,
 * on some panel, in some browser - Onion Skin's longer title just meant more of its header was the kind
 * of plain text a browser might read as "start selecting" instead of "start dragging".
 *
 * This replaces all of that with plain pointer events, entirely inside this app's own control: a panel
 * header captures the pointer on pointerdown (see EditorDock.tsx's DockPanel), and every subsequent
 * move/up is guaranteed to reach it regardless of what's visually underneath the cursor - the same
 * `setPointerCapture` idiom this file's own resize handles (PanelDivider, ColumnDivider, the dock's
 * outer edge) already use elsewhere in this codebase, just extended to reordering instead of resizing.
 * What the pointer is currently over is answered separately, with `elementFromPoint` (see
 * computeDropLocation) - capture controls *event delivery*, not hit-testing, so the two combine cleanly:
 * every move is delivered no matter where the pointer wanders, and each one is hit-tested against
 * whatever is actually there.
 */

export type DockDropLocation = { zone: DockZone; target: DockDropTarget };

function sameTarget(a: DockDropTarget, b: DockDropTarget): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'new' && b.kind === 'new') return a.index === b.index;
  if (a.kind === 'column' && b.kind === 'column') return a.index === b.index && a.beforeId === b.beforeId;
  return false;
}

function sameLocation(a: DockDropLocation | null, b: DockDropLocation | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.zone === b.zone && sameTarget(a.target, b.target);
}

/**
 * Reads whatever drop target the pointer is over right now, from the `data-drop-*` markers
 * DockZoneView/DockColumn/NewColumnStrip carry (see EditorDock.tsx). `elementFromPoint` skips anything
 * with `pointer-events: none`, which is why the floating drag ghost (see DockDragGhost) has to have
 * that set - without it, the ghost would be the topmost thing at the cursor's own position and every
 * hit-test would just find itself.
 */
function computeDropLocation(x: number, y: number): DockDropLocation | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const hit = el?.closest<HTMLElement>('[data-drop-kind]');
  if (!hit) return null;
  const zone = hit.dataset.dropZone as DockZone;
  const index = Number(hit.dataset.dropIndex ?? 0);

  if (hit.dataset.dropKind === 'new') return { zone, target: { kind: 'new', index } };

  if (hit.dataset.dropKind === 'column') {
    let beforeId: DockPanelId | null = null;
    for (const panelEl of hit.querySelectorAll<HTMLElement>(':scope > [data-panel-id]')) {
      const r = panelEl.getBoundingClientRect();
      if (y < r.top + r.height / 2) {
        beforeId = panelEl.dataset.panelId as DockPanelId;
        break;
      }
    }
    return { zone, target: { kind: 'column', index, beforeId } };
  }

  // 'zone': dock chrome outside any column or gap (its padding, or an empty dock with nothing in it
  // yet) - the same fallback a drop anywhere else in it has always used: an empty dock opens its first
  // column, a non-empty one appends to its last.
  const empty = hit.dataset.dropEmpty === '1';
  const columnCount = Number(hit.dataset.dropColumnCount ?? 0);
  return { zone, target: empty ? { kind: 'new', index: 0 } : { kind: 'column', index: columnCount - 1, beforeId: null } };
}

export type DockDragApi = {
  /** The panel currently being dragged, or null the rest of the time. */
  dragging: DockPanelId | null;
  /** Where it would land if released right now - drives the highlight on whichever dock/column/gap
   *  the pointer is over (see the `data-drop-active` attributes in EditorDock.tsx). */
  dropLocation: DockDropLocation | null;
  /** Attach to the element that should visually follow the cursor while dragging - see DockDragGhost. */
  ghostRef: React.RefObject<HTMLDivElement | null>;
  /** Starts a drag: called by DockPanel's own pointerdown/pointermove once the pointer has moved far
   *  enough from where it went down to mean "drag", not "click". */
  onDragStart: (panel: DockPanelId, x: number, y: number) => void;
  /** Called on every pointermove once a drag is underway. */
  onDragMove: (x: number, y: number) => void;
  /** Called on pointerup - commits the move if the pointer is over a valid target, otherwise the panel
   *  simply stays where it was. */
  onDragEnd: () => void;
  /** Called on pointercancel, or when Escape is pressed mid-drag - always abandons the drag with no
   *  move committed, regardless of where the pointer happens to be. */
  onDragCancel: () => void;
};

/** Native drag-and-drop auto-scrolled a container the pointer hovered near the edge of even while
 *  perfectly still; nothing about plain pointer events does that for free, and without it a dock or
 *  panel sitting below the fold (the library dock on a short window, say) would be reachable to drop
 *  something into only by coincidence of where the window happened to be scrolled when the drag began.
 *  EDGE_PX is how close counts as "near the edge"; MAX_PX_PER_TICK is the fastest that edge scrolls. */
const AUTO_SCROLL_EDGE_PX = 56;
const AUTO_SCROLL_MAX_PX_PER_TICK = 18;

/** Whichever scrollable ancestor of `.editor-shell` actually has something to scroll - not necessarily
 *  `.editor-shell` itself. It sets `overflow: auto` as a fallback for when its own box doesn't fit its
 *  parent, but the two have grown to fit each other before now (see index.css) and it's `main` around
 *  it that actually clips and scrolls; walking up to find whoever really has the overflow, rather than
 *  hard-coding either one, is what keeps this correct if that ever shifts again. */
function findScrollContainer(from: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null = from;
  while (el) {
    if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) return el;
    el = el.parentElement;
  }
  return document.scrollingElement as HTMLElement | null;
}

export function useDockDrag(onDrop: (panel: DockPanelId, location: DockDropLocation) => void): DockDragApi {
  const [dragging, setDragging] = useState<DockPanelId | null>(null);
  const [dropLocation, setDropLocation] = useState<DockDropLocation | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  // Mirrors of the state above, read synchronously inside onDragEnd/onDragMove - React state updates
  // are batched and can't be relied on to reflect the latest call by the time the next one runs, but a
  // fast pointerup right after a pointermove needs exactly that.
  const draggingRef = useRef<DockPanelId | null>(null);
  const dropLocationRef = useRef<DockDropLocation | null>(null);
  /** The pointer's last known screen position - read by the auto-scroll loop below, which has to keep
   *  running on its own timer (a still pointer sends no pointermove events at all) rather than only
   *  react to ones that arrive. */
  const pointerRef = useRef<{ x: number; y: number } | null>(null);

  const moveGhost = useCallback((x: number, y: number) => {
    const el = ghostRef.current;
    // Direct DOM write, not React state - the same reasoning PixelCanvas's own panBy gives for writing
    // its transform straight to the DOM: a fast pointermove can fire far more often than a render needs
    // to happen, and nothing here reads the ghost's position back, so there's nothing a render would add.
    if (el) el.style.transform = `translate(${x + 14}px, ${y + 14}px)`;
  }, []);

  const clear = useCallback(() => {
    draggingRef.current = null;
    dropLocationRef.current = null;
    setDragging(null);
    setDropLocation(null);
  }, []);

  /** Re-hit-tests at the pointer's last known position - called after moving it (a real pointermove) or
   *  after the page scrolled under it (the auto-scroll loop below), since either one can change what's
   *  actually under a screen position that didn't itself move. */
  const refreshDropLocation = useCallback((x: number, y: number) => {
    const next = computeDropLocation(x, y);
    if (sameLocation(dropLocationRef.current, next)) return;
    dropLocationRef.current = next;
    setDropLocation(next);
  }, []);

  const onDragStart = useCallback(
    (panel: DockPanelId, x: number, y: number) => {
      draggingRef.current = panel;
      pointerRef.current = { x, y };
      setDragging(panel);
      moveGhost(x, y);
      const loc = computeDropLocation(x, y);
      dropLocationRef.current = loc;
      setDropLocation(loc);
    },
    [moveGhost]
  );

  const onDragMove = useCallback(
    (x: number, y: number) => {
      if (!draggingRef.current) return;
      pointerRef.current = { x, y };
      moveGhost(x, y);
      refreshDropLocation(x, y);
    },
    [moveGhost, refreshDropLocation]
  );

  const onDragEnd = useCallback(() => {
    const panel = draggingRef.current;
    const location = dropLocationRef.current;
    clear();
    if (panel && location) onDrop(panel, location);
  }, [clear, onDrop]);

  const onDragCancel = useCallback(() => {
    clear();
  }, [clear]);

  // Auto-scrolls .editor-shell (the one scrolling ancestor everything in the dock layout sits inside -
  // see index.css) toward the pointer whenever a drag holds it near that container's own edge, on a
  // timer rather than only in response to pointermove: a pointer parked at the edge and held still
  // still has to keep scrolling, the same way it would dragging a native OS selection or file.
  useEffect(() => {
    if (!dragging) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const pt = pointerRef.current;
      const shell = document.querySelector<HTMLElement>('.editor-shell');
      const scroller = shell && findScrollContainer(shell);
      if (!pt || !scroller) return;
      const r = scroller.getBoundingClientRect();
      const along = (pos: number, near: number, far: number): number => {
        if (pos < near + AUTO_SCROLL_EDGE_PX) return -Math.round(((near + AUTO_SCROLL_EDGE_PX - pos) / AUTO_SCROLL_EDGE_PX) * AUTO_SCROLL_MAX_PX_PER_TICK);
        if (pos > far - AUTO_SCROLL_EDGE_PX) return Math.round(((pos - (far - AUTO_SCROLL_EDGE_PX)) / AUTO_SCROLL_EDGE_PX) * AUTO_SCROLL_MAX_PX_PER_TICK);
        return 0;
      };
      const dx = along(pt.x, r.left, r.right);
      const dy = along(pt.y, r.top, r.bottom);
      if (dx === 0 && dy === 0) return;
      const before = { left: scroller.scrollLeft, top: scroller.scrollTop };
      scroller.scrollBy(dx, dy);
      // Only re-hit-test if the scroll actually moved something - already at an edge (nothing left to
      // scroll) is the common steady state while the pointer sits in the margin, and re-running
      // computeDropLocation every single frame for no reason is pure waste.
      if (scroller.scrollLeft !== before.left || scroller.scrollTop !== before.top) refreshDropLocation(pt.x, pt.y);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [dragging, refreshDropLocation]);

  // Escape cancels the drag outright, same as it cancels a canvas gesture in progress - the pointer is
  // still physically down (still captured by the panel header that started this), but clearing the
  // controller's own state here makes every further move/up from it a no-op (see onDragMove/onDragEnd's
  // own `if (!draggingRef.current) return` guards), so the eventual release commits nothing.
  useEffect(() => {
    if (!dragging) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDragCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dragging, onDragCancel]);

  return { dragging, dropLocation, ghostRef, onDragStart, onDragMove, onDragEnd, onDragCancel };
}
