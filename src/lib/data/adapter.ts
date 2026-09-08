import type {
  BackgroundTransform,
  CanvasBackground,
  Instance,
  OnionSettings,
  RoomInstance,
  Sprite,
  TankGroup,
  TankShape,
} from '../types';

/**
 * Everything the tank persists, as one value. It is saved as one batch (the tank has an explicit Save
 * button - see TankEngine.save) so there is no reason for the storage layer to know about its parts.
 */
export interface TankState {
  instances: Instance[];
  groups: TankGroup[];
  roomInstances: RoomInstance[];
  width: number | null;
  height: number | null;
  shape: TankShape;
  cornerRadiusFrac: number;
  ovalTopCutFrac: number;
  backgroundSpriteId: string | null;
  backgroundTransform: BackgroundTransform;
  waterLevel: number;
  algae: number;
  lastTickAt: number | null;
}

/** One tank in the list, without its contents - enough to show a picker (plan P4-4) without loading
 *  every fish in every tank. */
export interface TankSummary {
  id: string;
  name: string;
  updatedAt: number;
}

/** Editor preferences that belong to the user rather than to this browser - they will follow an
 *  account once there is one (see the plan's §5: user_prefs). Device-only preferences (theme, UI
 *  scale, dock layout) deliberately stay in storage.ts and never come through here. */
export interface EditorPrefs {
  paletteColors: string[] | null;
  savedColors: string[];
  pinnedColors: string[];
  brushSizes: Record<string, number>;
  canvasBackground: CanvasBackground | null;
  onion: OnionSettings | null;
}

/**
 * The one seam between the app and wherever its data actually lives.
 *
 * Every method is async even though today's implementation answers immediately from localStorage: a
 * database, or an IndexedDB store, or an HTTP call cannot answer synchronously, and the point of this
 * interface is that swapping one in changes only the implementation - not a single caller. See
 * docs/STORAGE_DB_MIGRATION_PLAN.md §3.
 */
export interface StorageAdapter {
  listSprites(): Promise<Sprite[]>;
  /** Writes the live sprites. Deleted ones are handled by the implementation (a tombstone in the
   *  localStorage backend); callers only ever pass what still exists. */
  saveSprites(sprites: Sprite[]): Promise<void>;

  /** Which tank load/saveTankState address when no id is given. A user has several tanks (that is the
   *  agreed shape - see the plan's §0), and one of them is the one currently open; the id exists even
   *  while there is only one, because adding it later, to data that already exists, is the expensive
   *  version of this change. */
  getCurrentTankId(): Promise<string>;
  setCurrentTankId(id: string): Promise<void>;
  listTanks(): Promise<TankSummary[]>;

  loadTankState(tankId?: string): Promise<TankState>;
  saveTankState(state: TankState, tankId?: string): Promise<void>;

  loadEditorPrefs(): Promise<EditorPrefs>;
  /** Partial by design: preferences are written one at a time as the user changes them, and a patch
   *  keeps a caller from having to hold (and accidentally overwrite) the ones it does not touch. */
  saveEditorPrefs(patch: Partial<EditorPrefs>): Promise<void>;
}
