import { useCallback, useState } from 'react';
import { KEY_EDITOR_LAYOUT, loadRawPref, saveRawPref } from '@/lib/storage';

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
  /** Widths (px) for columns whose divider has been dragged, keyed by the column's own panel
   *  composition (see columnKey) - a column with no entry keeps the automatic content-based width (see
   *  naturalColumnWidth). Keying by composition rather than position means a column keeps the width it
   *  was given as panels move around it; a column whose own contents change gets a fresh key and simply
   *  reverts to sizing itself, which is the reasonable default for a column that's now holding
   *  something different. */
  columnWidths: Partial<Record<string, number>>;
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
  columnWidths: {},
};

/** Drag limits per zone - wide enough for the widest control each side holds, bounded so a stray drag
 *  can't squeeze the canvas out of existence. The left/right maximum allows for two columns side by
 *  side, which is the point of being able to split a dock at all. */
export const ZONE_LIMITS: Record<DockZone, { min: number; max: number }> = {
  // The upper bound has to leave room for several columns side by side, since that is what a dock
  // widens to when panels are dropped into new ones (see movePanel).
  left: { min: 132, max: 1400 },
  right: { min: 132, max: 1400 },
  // The bottom minimum is a whole library card plus its tabs: below that the panel is a header with a
  // sliver under it, which reads as "the library is gone" rather than "the library is small". A stored
  // size from before this floor existed is clamped up to it on load (see normalize).
  bottom: { min: 152, max: 520 },
};

/** Panels that are a grid of icon buttons and read just as well one button wide - a column of only
 *  these is laid out narrow (see .dock-column[data-narrow] in index.css), so it needs far less room
 *  than one holding the palette or the layer list. Kept in step with EditorDock's own NARROW_PANELS. */
const NARROW_PANEL_IDS: DockPanelId[] = ['tools', 'transform'];

const NARROW_COLUMN_REM = 3.6;
const WIDE_COLUMN_REM = 8.5;

/** A column's identity for both columnWidths (below) and React's own list key: its panels, in order,
 *  joined into one string. Two columns holding the same panels in the same order are indistinguishable
 *  as far as sizing goes, which is exactly the property this needs. */
export function columnKey(column: DockPanelId[]): string {
  return column.join('-');
}

/** How much width a column needs by default - i.e. with no explicit override - in px at the current
 *  interface size. Sizing a dock from the sum of these (see zoneWidthFor) - rather than "every column
 *  gets the widest column's width" - is what lets half a dozen columns sit side by side without the
 *  dock overflowing into a horizontal scrollbar. */
function naturalColumnWidth(column: DockPanelId[]): number {
  const narrow = column.length > 0 && column.every((id) => NARROW_PANEL_IDS.includes(id));
  return Math.round((narrow ? NARROW_COLUMN_REM : WIDE_COLUMN_REM) * rootRemPx()) + 5;
}

/** A column's actual width: whatever its own divider was dragged to (see setColumnWidth), or its
 *  natural content-based width otherwise. */
function effectiveColumnWidth(column: DockPanelId[], columnWidths: Partial<Record<string, number>>): number {
  return columnWidths[columnKey(column)] ?? naturalColumnWidth(column);
}

function zoneWidthFor(columns: DockColumns, columnWidths: Partial<Record<string, number>> = {}): number {
  return columns.reduce((sum, column) => sum + effectiveColumnWidth(column, columnWidths), 0);
}

export const MIN_PANEL_HEIGHT = 64;
export const MAX_PANEL_HEIGHT = 1400;

/** Well short of ZONE_LIMITS' own ceiling, so one wide column can't alone force a dock past what's
 *  usable. The floor is per column instead - see minColumnWidth. */
export const MAX_COLUMN_WIDTH = 640;

/** Matches .dock-column's own min-width in index.css. A column of ordinary panels stops here because
 *  that's where the browser stops it anyway; storing anything smaller would only put the layout's idea
 *  of the dock's width out of step with what's actually on screen, by the difference. */
const COLUMN_MIN_REM = 7.75;

/** The root font size in px - i.e. what a rem is worth right now, which the interface-size setting
 *  (see useUiScale) changes. Everything here that has to line up with a rem-based rule in index.css
 *  goes through this rather than assuming 16. */
export function rootRemPx(): number {
  return typeof window === 'undefined' ? 16 : parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

/** How narrow a column may be dragged. An icon-button column goes all the way down to a single button -
 *  squeezing Tools into one narrow strip is the entire point of that layout, and a flat floor shared
 *  with the palette's column is what made it impossible. */
function minColumnWidth(column: DockPanelId[]): number {
  const narrow = column.length > 0 && column.every((id) => NARROW_PANEL_IDS.includes(id));
  return Math.round((narrow ? NARROW_COLUMN_REM : COLUMN_MIN_REM) * rootRemPx());
}

/** Declared in storage.ts (KEY_EDITOR_LAYOUT) rather than here, so downloadDataBackup()/resetAllData()
 *  cover this key too - the layout is written straight to localStorage from this hook, not through a
 *  save*() helper. */
const STORAGE_KEY = KEY_EDITOR_LAYOUT;

/** Left/right docks are additionally capped at a share of the window: without it a dock keeps growing
 *  as columns are added until its far edge - and the panels near it - sit off the side of the screen,
 *  reachable only by scrolling the whole workspace sideways. */
const ZONE_VIEWPORT_SHARE = 0.42;

function zoneMaxWidth(zone: DockZone): number {
  const ceiling = ZONE_LIMITS[zone].max;
  if (zone === 'bottom' || typeof window === 'undefined') return ceiling;
  return Math.max(ZONE_LIMITS[zone].min, Math.min(ceiling, Math.round(window.innerWidth * ZONE_VIEWPORT_SHARE)));
}

const clampSize = (zone: DockZone, px: number): number =>
  Math.round(Math.min(zoneMaxWidth(zone), Math.max(ZONE_LIMITS[zone].min, px)));

const clampPanelHeight = (px: number): number => Math.round(Math.min(MAX_PANEL_HEIGHT, Math.max(MIN_PANEL_HEIGHT, px)));

const clampColumnWidth = (column: DockPanelId[], px: number): number =>
  Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(minColumnWidth(column), px)));

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
  const source = (raw ?? {}) as {
    zones?: Record<string, unknown>;
    sizes?: Record<string, unknown>;
    panelHeights?: Record<string, unknown>;
    columnWidths?: Record<string, unknown>;
  };
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

  // Keyed by panel composition, so a stored width only means anything while a column with exactly those
  // panels still exists - which doubles as the cleanup for entries left behind by columns that have
  // since been rearranged.
  const columnByKey = new Map<string, DockPanelId[]>();
  for (const zone of DOCK_ZONES) for (const column of zones[zone]) columnByKey.set(columnKey(column), column);

  const columnWidths: Partial<Record<string, number>> = {};
  if (source.columnWidths && typeof source.columnWidths === 'object') {
    for (const [key, raw] of Object.entries(source.columnWidths)) {
      const px = Number(raw);
      const column = columnByKey.get(key);
      if (Number.isFinite(px) && column) columnWidths[key] = clampColumnWidth(column, px);
    }
  }

  const sizes = {} as Record<DockZone, number>;
  for (const zone of DOCK_ZONES) {
    const px = Number(source.sizes?.[zone]);
    if (Number.isFinite(px)) sizes[zone] = clampSize(zone, px);
    else sizes[zone] = zone === 'bottom' ? defaultBottomSize() : DEFAULT_LAYOUT.sizes[zone];
  }
  // A dock has to be at least as wide as the columns in it. A layout saved before docks grew with their
  // column count can hold six columns in a 196px strip, which is how every panel in it ends up squeezed
  // to a third of its width; widening it on load is what makes those columns open at full size.
  for (const zone of ['left', 'right'] as const) {
    if (zones[zone].length > 1) sizes[zone] = clampSize(zone, Math.max(sizes[zone], zoneWidthFor(zones[zone], columnWidths)));
  }

  const panelHeights: Partial<Record<DockPanelId, number>> = {};
  for (const id of DOCK_PANEL_IDS) {
    const px = Number(source.panelHeights?.[id]);
    if (Number.isFinite(px)) panelHeights[id] = clampPanelHeight(px);
  }

  return { zones, sizes, panelHeights, columnWidths };
}

function load(): EditorLayout {
  try {
    const raw = loadRawPref(STORAGE_KEY);
    return normalize(raw ? JSON.parse(raw) : null);
  } catch {
    // Unreadable or blocked storage just means "the default layout", never a failure to render.
    return normalize(null);
  }
}

function save(layout: EditorLayout): void {
  saveRawPref(STORAGE_KEY, JSON.stringify(layout));
}

export type EditorLayoutApi = {
  layout: EditorLayout;
  /** Moves `panel` into `zone` at `target` - an existing column, or a new one opened at that position.
   *  Columns left empty by the move are closed, so a dock never keeps a blank strip around. */
  movePanel: (panel: DockPanelId, zone: DockZone, target: DockDropTarget) => void;
  setZoneSize: (zone: DockZone, px: number) => void;
  /** `null` clears the panel's height, handing it back to the automatic "as tall as its contents"
   *  sizing - the way out of a divider drag that went too far. */
  setPanelHeight: (panel: DockPanelId, px: number | null) => void;
  /** Sets one column's width (identified by columnKey) within `zone`. `null` clears it, handing the
   *  column back to its natural content-based width. The dock's own outer size moves by exactly the
   *  same amount the column did, so widening or narrowing a column never squeezes its neighbours below
   *  their own floor - it just asks the dock (and so the canvas) for more or less room. */
  setColumnWidth: (key: string, zone: DockZone, px: number | null) => void;
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

      // A dock grows and shrinks with its column count, keeping the width *per column* the user set.
      // Splitting the width between the columns instead - which is what a fixed dock width does - halves
      // every panel the moment a second column appears, and none of them can lay out their controls at
      // that width. Only left/right: the bottom dock's size is its height, which columns don't change.
      const sizes = { ...prev.sizes };
      for (const z of ['left', 'right'] as const) {
        const before = prev.zones[z].length;
        const after = zones[z].length;
        if (before === after) continue;
        if (after === 0) continue;
        // The dock grows by exactly what the column that arrived needs (an icon-button column asks for
        // far less than a palette), and shrinks by the same when one leaves. Every column already there
        // keeps the width it had, and the new one still opens at full size - which is the whole point of
        // splitting a dock rather than dividing one fixed width more ways.
        const needed = zoneWidthFor(zones[z], prev.columnWidths);
        const delta = needed - zoneWidthFor(prev.zones[z], prev.columnWidths);
        sizes[z] = clampSize(z, Math.max(needed, prev.sizes[z] + delta));
      }

      const next = { ...prev, zones, sizes };
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

  const setPanelHeight = useCallback((panel: DockPanelId, px: number | null) => {
    setLayout((prev) => {
      if (px === null) {
        if (prev.panelHeights[panel] === undefined) return prev;
        const panelHeights = { ...prev.panelHeights };
        delete panelHeights[panel];
        const cleared = { ...prev, panelHeights };
        save(cleared);
        return cleared;
      }
      const height = clampPanelHeight(px);
      if (prev.panelHeights[panel] === height) return prev;
      const next = { ...prev, panelHeights: { ...prev.panelHeights, [panel]: height } };
      save(next);
      return next;
    });
  }, []);

  const setColumnWidth = useCallback((key: string, zone: DockZone, px: number | null) => {
    setLayout((prev) => {
      const column = prev.zones[zone].find((col) => columnKey(col) === key);
      if (!column) return prev;
      const before = effectiveColumnWidth(column, prev.columnWidths);
      const columnWidths = { ...prev.columnWidths };
      if (px === null) {
        if (columnWidths[key] === undefined) return prev;
        delete columnWidths[key];
      } else {
        const width = clampColumnWidth(column, px);
        if ((columnWidths[key] ?? before) === width) return prev;
        columnWidths[key] = width;
      }
      // Grow or shrink the dock by exactly what this column gained or gave up, the same "the dock moves
      // with what's asked of it" rule setZoneSize's own edge follows - so a widened column never eats
      // into a neighbour's space, and a narrowed one gives its room back to the canvas rather than
      // leaving it as dead space in the dock.
      const after = effectiveColumnWidth(column, columnWidths);
      const sizes = { ...prev.sizes, [zone]: clampSize(zone, prev.sizes[zone] + (after - before)) };
      const next = { ...prev, columnWidths, sizes };
      save(next);
      return next;
    });
  }, []);

  const resetLayout = useCallback(() => commit(normalize(null)), [commit]);

  return { layout, movePanel, setZoneSize, setPanelHeight, setColumnWidth, resetLayout };
}
