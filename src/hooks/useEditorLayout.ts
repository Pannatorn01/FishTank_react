import { useCallback, useState } from 'react';

/**
 * Which of the three docks around the canvas a panel currently lives in. The canvas itself is always
 * the centre and can't be docked anywhere - everything else can sit left, right, or along the bottom,
 * which is the part of Aseprite's layout freedom that actually matters here: the palette next to the
 * hand you draw with, the library wide across the bottom where a lot of thumbnails fit.
 */
export type DockZone = 'left' | 'right' | 'bottom';

export type DockPanelId = 'tools' | 'palette' | 'preview' | 'onion' | 'transform' | 'layers' | 'library';

export const DOCK_ZONES: DockZone[] = ['left', 'right', 'bottom'];

/** Every panel that can be docked, in the order a rebuilt layout falls back to. */
export const DOCK_PANEL_IDS: DockPanelId[] = ['tools', 'palette', 'preview', 'onion', 'transform', 'layers', 'library'];

/** A dock is a row of columns; a column is a top-to-bottom stack of panels. One column is the familiar
 *  single strip; splitting a dock into two puts panels side by side, which is what makes a wide dock
 *  usable instead of one very long scroll - and is why a zone holds columns rather than a flat list. */
export type DockColumns = DockPanelId[][];

export type EditorLayout = {
  zones: Record<DockZone, DockColumns>;
  /** Zone thickness in px: width for left/right, height for bottom. */
  sizes: Record<DockZone, number>;
  /** Heights (px) for panels whose divider has been dragged. A panel with no entry keeps the automatic
   *  behaviour: sized to its content, or filling the leftover space for the ones that should. */
  panelHeights: Partial<Record<DockPanelId, number>>;
};

/** Where a dragged panel is being dropped: into an existing column (optionally above one of its
 *  panels), or into a new column opened at `index` among that zone's columns. */
export type DockDropTarget =
  | { kind: 'column'; index: number; beforeId: DockPanelId | null }
  | { kind: 'new'; index: number };

/** The layout the editor has always had, now just written down as data. */
export const DEFAULT_LAYOUT: EditorLayout = {
  zones: {
    left: [['tools', 'palette']],
    right: [['preview', 'onion', 'transform', 'layers']],
    bottom: [['library']],
  },
  sizes: { left: 196, right: 196, bottom: 172 },
  panelHeights: {},
};

/** Drag limits per zone - wide enough for the widest control each side holds, bounded so a stray drag
 *  can't squeeze the canvas out of existence. The left/right maximum allows for two columns side by
 *  side, which is the point of being able to split a dock at all. */
export const ZONE_LIMITS: Record<DockZone, { min: number; max: number }> = {
  left: { min: 132, max: 760 },
  right: { min: 132, max: 760 },
  // The bottom minimum is a whole library card plus its tabs: below that the panel is a header with a
  // sliver under it, which reads as "the library is gone" rather than "the library is small". A stored
  // size from before this floor existed is clamped up to it on load (see normalize).
  bottom: { min: 152, max: 520 },
};

export const MIN_PANEL_HEIGHT = 64;
export const MAX_PANEL_HEIGHT = 1400;

const STORAGE_KEY = 'fishtank.editorLayout.v1';

const clampSize = (zone: DockZone, px: number): number =>
  Math.round(Math.min(ZONE_LIMITS[zone].max, Math.max(ZONE_LIMITS[zone].min, px)));

const clampPanelHeight = (px: number): number => Math.round(Math.min(MAX_PANEL_HEIGHT, Math.max(MIN_PANEL_HEIGHT, px)));

/** The bottom dock's height on a first run: tall enough for a whole row of library cards, but never so
 *  much of a short window that the canvas is squeezed flat - opening the editor on a laptop screen
 *  shouldn't need a drag before it fits. Only ever a default; a size the user set always wins. */
function defaultBottomSize(): number {
  const viewport = typeof window === 'undefined' ? 900 : window.innerHeight;
  return clampSize('bottom', Math.min(DEFAULT_LAYOUT.sizes.bottom, Math.round(viewport * 0.2)));
}

/**
 * Rebuilds a usable layout out of whatever was stored. Anything unrecognised is dropped and anything
 * missing is appended to the zone it starts in by default, so a layout saved by an older build (or one
 * hand-edited into nonsense) can still open - a panel silently vanishing because its id changed would
 * leave no way back to it short of clearing site data.
 *
 * That covers the shape change from one flat list per zone to a list of columns: a stored
 * `left: ['tools','palette']` is read as the single column it always was.
 */
function normalize(raw: unknown): EditorLayout {
  const source = (raw ?? {}) as { zones?: Record<string, unknown>; sizes?: Record<string, unknown>; panelHeights?: Record<string, unknown> };
  const seen = new Set<DockPanelId>();
  const keep = (id: unknown): id is DockPanelId => {
    if (!DOCK_PANEL_IDS.includes(id as DockPanelId) || seen.has(id as DockPanelId)) return false;
    seen.add(id as DockPanelId);
    return true;
  };

  const zones = {} as Record<DockZone, DockColumns>;
  for (const zone of DOCK_ZONES) {
    const stored = source.zones?.[zone];
    const columns: DockColumns = !Array.isArray(stored)
      ? []
      : typeof stored[0] === 'string'
        ? // The pre-columns shape: a flat list of ids, i.e. exactly one column.
          [(stored as unknown[]).filter(keep)]
        : (stored as unknown[]).map((col) => (Array.isArray(col) ? col.filter(keep) : []));
    zones[zone] = columns.filter((col) => col.length > 0);
  }
  for (const zone of DOCK_ZONES) {
    for (const id of DEFAULT_LAYOUT.zones[zone].flat()) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (zones[zone].length === 0) zones[zone].push([]);
      zones[zone][0].push(id);
    }
  }

  const sizes = {} as Record<DockZone, number>;
  for (const zone of DOCK_ZONES) {
    const px = Number(source.sizes?.[zone]);
    if (Number.isFinite(px)) sizes[zone] = clampSize(zone, px);
    else sizes[zone] = zone === 'bottom' ? defaultBottomSize() : DEFAULT_LAYOUT.sizes[zone];
  }

  const panelHeights: Partial<Record<DockPanelId, number>> = {};
  for (const id of DOCK_PANEL_IDS) {
    const px = Number(source.panelHeights?.[id]);
    if (Number.isFinite(px)) panelHeights[id] = clampPanelHeight(px);
  }

  return { zones, sizes, panelHeights };
}

function load(): EditorLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return normalize(raw ? JSON.parse(raw) : null);
  } catch {
    // Unreadable or blocked storage just means "the default layout", never a failure to render.
    return normalize(null);
  }
}

function save(layout: EditorLayout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Not being able to remember the arrangement is no reason to refuse to make it.
  }
}

export type EditorLayoutApi = {
  layout: EditorLayout;
  /** Moves `panel` into `zone` at `target` - an existing column, or a new one opened at that position.
   *  Columns left empty by the move are closed, so a dock never keeps a blank strip around. */
  movePanel: (panel: DockPanelId, zone: DockZone, target: DockDropTarget) => void;
  setZoneSize: (zone: DockZone, px: number) => void;
  setPanelHeight: (panel: DockPanelId, px: number) => void;
  resetLayout: () => void;
};

export function useEditorLayout(): EditorLayoutApi {
  const [layout, setLayout] = useState<EditorLayout>(load);

  const commit = useCallback((next: EditorLayout) => {
    setLayout(next);
    save(next);
  }, []);

  const movePanel = useCallback((panel: DockPanelId, zone: DockZone, target: DockDropTarget) => {
    setLayout((prev) => {
      const zones = {} as Record<DockZone, DockColumns>;
      for (const z of DOCK_ZONES) zones[z] = prev.zones[z].map((col) => [...col]);

      // The target column is resolved (and a new one opened) *before* the panel is pulled out of
      // wherever it was, and mutated in place afterwards - so removing the panel can't shift the index
      // the drop was aimed at. Reordering within one column is the case that would otherwise be off by
      // one every time.
      if (target.kind === 'new') {
        const at = Math.max(0, Math.min(zones[zone].length, target.index));
        zones[zone].splice(at, 0, []);
      }
      const columnIndex = target.kind === 'new' ? Math.max(0, Math.min(zones[zone].length - 1, target.index)) : target.index;
      const column = zones[zone][columnIndex];
      if (!column) return prev;

      for (const z of DOCK_ZONES) {
        for (const col of zones[z]) {
          const i = col.indexOf(panel);
          if (i >= 0) col.splice(i, 1);
        }
      }

      const before = target.kind === 'column' && target.beforeId && target.beforeId !== panel ? column.indexOf(target.beforeId) : -1;
      if (before >= 0) column.splice(before, 0, panel);
      else column.push(panel);

      for (const z of DOCK_ZONES) zones[z] = zones[z].filter((col) => col.length > 0);

      const next = { ...prev, zones };
      save(next);
      return next;
    });
  }, []);

  const setZoneSize = useCallback((zone: DockZone, px: number) => {
    setLayout((prev) => {
      const size = clampSize(zone, px);
      if (prev.sizes[zone] === size) return prev;
      const next = { ...prev, sizes: { ...prev.sizes, [zone]: size } };
      save(next);
      return next;
    });
  }, []);

  const setPanelHeight = useCallback((panel: DockPanelId, px: number) => {
    setLayout((prev) => {
      const height = clampPanelHeight(px);
      if (prev.panelHeights[panel] === height) return prev;
      const next = { ...prev, panelHeights: { ...prev.panelHeights, [panel]: height } };
      save(next);
      return next;
    });
  }, []);

  const resetLayout = useCallback(() => commit(normalize(null)), [commit]);

  return { layout, movePanel, setZoneSize, setPanelHeight, resetLayout };
}
