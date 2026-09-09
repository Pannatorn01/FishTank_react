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
  /** Life mode's room backdrop (roomScene.ts), null for its built-in gradient. Distinct from
   *  backgroundSpriteId, which is the picture inside the water. */
  roomBackgroundSpriteId: string | null;
  backgroundTransform: BackgroundTransform;
  waterLevel: number;
  algae: number;
  lastTickAt: number | null;
}

/**
 * A tank with nothing in it - what a brand new tank starts as, and the base a partially-specified tank
 * (a remote one, a test fixture) is filled in from.
 *
 * It lives here, beside the interface, because it is the one thing every producer of a `TankState`
 * needs and none of them should get from each other: the IndexedDB adapter and the remote-share reader
 * both built this list of fields by hand, identically, and a tank that a viewer is only looking at has
 * no business importing local storage's code to get it. That arrangement is the same shape of mistake
 * that let `TankEngine.refresh` fall three fields behind `loadEverything` and carry one tank's water
 * level and algae onto another.
 *
 * This is the one *default*, not the only place a `TankState` is built. Two others construct one from a
 * real source and legitimately have to name every field - `TankEngine.snapshotForStorage` (from the
 * engine's live fields) and `LocalStorageAdapter.loadTankState` (from its per-key reads) - and the
 * compiler stops on both when a field is added, which is exactly what should happen: each has to decide
 * where the new value comes from. Anything that just wants "an empty tank" uses this.
 *
 * `lastTickAt: null` means "never simulated", which is the right default for both callers of this but
 * for different reasons - see each one.
 */
export function emptyTankState(): TankState {
  return {
    instances: [],
    groups: [],
    roomInstances: [],
    width: null,
    height: null,
    shape: 'rectangle',
    cornerRadiusFrac: 0.22,
    ovalTopCutFrac: 0.28,
    backgroundSpriteId: null,
    roomBackgroundSpriteId: null,
    backgroundTransform: { x: 0, y: 0, scale: 1, rotation: 0 },
    waterLevel: 1,
    algae: 0,
    lastTickAt: null,
  };
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

  /** False for a backend that can only ever hold one tank (localStorage). The UI hides the tank
   *  switcher rather than offering controls that would fail - an offer nobody can accept is worse
   *  than no offer. */
  readonly supportsMultipleTanks: boolean;
  /** Creates an empty tank and returns its id. Does not switch to it: that is the caller's decision,
   *  and the engine has unsaved state to deal with first. */
  createTank(name: string): Promise<string>;
  renameTank(id: string, name: string): Promise<void>;
  /** Removes a tank and everything in it. The last tank cannot be deleted - a user with no tank at all
   *  has nowhere to put a fish, and the app would have to invent one back immediately. */
  deleteTank(id: string): Promise<void>;

  loadTankState(tankId?: string): Promise<TankState>;
  saveTankState(state: TankState, tankId?: string): Promise<void>;

  loadEditorPrefs(): Promise<EditorPrefs>;
  /** Partial by design: preferences are written one at a time as the user changes them, and a patch
   *  keeps a caller from having to hold (and accidentally overwrite) the ones it does not touch. */
  saveEditorPrefs(patch: Partial<EditorPrefs>): Promise<void>;
}
