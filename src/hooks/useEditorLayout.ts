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

export type EditorLayout = {
  zones: Record<DockZone, DockPanelId[]>;
  /** Zone thickness in px: width for left/right, height for bottom. */
  sizes: Record<DockZone, number>;
};

/** The layout the editor has always had, now just written down as data. */
export const DEFAULT_LAYOUT: EditorLayout = {
  zones: {
    left: ['tools', 'palette'],
    right: ['preview', 'onion', 'transform', 'layers'],
    bottom: ['library'],
  },
  sizes: { left: 196, right: 196, bottom: 172 },
};

/** Drag limits per zone - wide enough for the widest control each side holds, bounded so a stray drag
 *  can't squeeze the canvas out of existence. */
export const ZONE_LIMITS: Record<DockZone, { min: number; max: number }> = {
  left: { min: 132, max: 560 },
  right: { min: 132, max: 560 },
  // The bottom minimum is a whole library card plus its tabs: below that the panel is a header with a
  // sliver under it, which reads as "the library is gone" rather than "the library is small". A stored
  // size from before this floor existed is clamped up to it on load (see normalize).
  bottom: { min: 152, max: 520 },
};

const STORAGE_KEY = 'fishtank.editorLayout.v1';

const clampSize = (zone: DockZone, px: number): number =>
  Math.round(Math.min(ZONE_LIMITS[zone].max, Math.max(ZONE_LIMITS[zone].min, px)));

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
 */
function normalize(raw: unknown): EditorLayout {
  const source = (raw ?? {}) as Partial<EditorLayout>;
  const seen = new Set<DockPanelId>();
  const zones = {} as Record<DockZone, DockPanelId[]>;
  for (const zone of DOCK_ZONES) {
    const list = Array.isArray(source.zones?.[zone]) ? source.zones![zone] : [];
    zones[zone] = list.filter((id): id is DockPanelId => {
      if (!DOCK_PANEL_IDS.includes(id as DockPanelId) || seen.has(id as DockPanelId)) return false;
      seen.add(id as DockPanelId);
      return true;
    });
  }
  for (const zone of DOCK_ZONES) {
    for (const id of DEFAULT_LAYOUT.zones[zone]) {
      if (!seen.has(id)) {
        zones[zone].push(id);
        seen.add(id);
      }
    }
  }
  const sizes = {} as Record<DockZone, number>;
  for (const zone of DOCK_ZONES) {
    const px = Number(source.sizes?.[zone]);
    if (Number.isFinite(px)) sizes[zone] = clampSize(zone, px);
    else sizes[zone] = zone === 'bottom' ? defaultBottomSize() : DEFAULT_LAYOUT.sizes[zone];
  }
  return { zones, sizes };
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
  /** Moves `panel` into `zone`, before `beforeId` when given and at the end otherwise. Dropping a panel
   *  onto its own position is a no-op, so a mis-aimed drag costs nothing. */
  movePanel: (panel: DockPanelId, zone: DockZone, beforeId: DockPanelId | null) => void;
  setZoneSize: (zone: DockZone, px: number) => void;
  resetLayout: () => void;
};

export function useEditorLayout(): EditorLayoutApi {
  const [layout, setLayout] = useState<EditorLayout>(load);

  const commit = useCallback((next: EditorLayout) => {
    setLayout(next);
    save(next);
  }, []);

  const movePanel = useCallback(
    (panel: DockPanelId, zone: DockZone, beforeId: DockPanelId | null) => {
      setLayout((prev) => {
        const zones = {} as Record<DockZone, DockPanelId[]>;
        for (const z of DOCK_ZONES) zones[z] = prev.zones[z].filter((id) => id !== panel);
        const target = zones[zone];
        const index = beforeId && beforeId !== panel ? target.indexOf(beforeId) : -1;
        if (index >= 0) target.splice(index, 0, panel);
        else target.push(panel);
        const next = { ...prev, zones };
        save(next);
        return next;
      });
    },
    []
  );

  const setZoneSize = useCallback((zone: DockZone, px: number) => {
    setLayout((prev) => {
      const size = clampSize(zone, px);
      if (prev.sizes[zone] === size) return prev;
      const next = { ...prev, sizes: { ...prev.sizes, [zone]: size } };
      save(next);
      return next;
    });
  }, []);

  const resetLayout = useCallback(() => commit(normalize(null)), [commit]);

  return { layout, movePanel, setZoneSize, resetLayout };
}
