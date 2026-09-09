import * as storage from '../storage';
import type { Sprite } from '../types';
import type { EditorPrefs, StorageAdapter, TankState, TankSummary } from './adapter';

/**
 * The StorageAdapter backed by localStorage - i.e. exactly what the app did before this layer existed,
 * behind an async interface. It answers immediately (there is nothing to wait for), and every method
 * is a thin call into storage.ts: all the validation, migration and encoding still lives there, and
 * this file only decides *what to read and write together*.
 *
 * Keeping it deliberately dumb matters: it is the reference the IndexedDB and remote adapters are
 * checked against (plan P4/P5), so any behaviour that lives here rather than in storage.ts is
 * behaviour those two would have to reimplement.
 */
export class LocalStorageAdapter implements StorageAdapter {
  async listSprites(): Promise<Sprite[]> {
    return storage.loadSprites() ?? [];
  }

  async saveSprites(sprites: Sprite[]): Promise<void> {
    storage.saveSprites(sprites);
  }

  /** localStorage only ever held one tank, and it stays that way: this backend is what the IndexedDB
   *  one migrates *from* (see IndexedDbAdapter), not something new tanks are created in. The id is
   *  fixed so the migrated tank keeps a stable identity. */
  async getCurrentTankId(): Promise<string> {
    return SINGLE_TANK_ID;
  }

  async setCurrentTankId(_id?: string): Promise<void> {
    // Nothing to switch to.
  }

  /** One tank, always. Everything about this backend is a set of fixed keys (see storage.ts); a second
   *  tank would need a key per tank, which is the shape IndexedDB is for. */
  readonly supportsMultipleTanks = false;

  async createTank(_name?: string): Promise<string> {
    throw new Error('this browser can only store one tank');
  }

  async renameTank(_id?: string, _name?: string): Promise<void> {
    throw new Error('this browser can only store one tank');
  }

  async deleteTank(_id?: string): Promise<void> {
    throw new Error('this browser can only store one tank');
  }

  async listTanks(): Promise<TankSummary[]> {
    return [{ id: SINGLE_TANK_ID, name: 'My Tank', updatedAt: storage.loadTankLastTick() ?? 0 }];
  }

  async loadTankState(): Promise<TankState> {
    // Size is read before the room decor, not after: normalizeRoomInstances needs the tank's
    // dimensions to migrate a legacy record's viewport-fraction position onto the current
    // tank-relative one, and to clamp an already-current record inside the room's margins.
    const size = storage.loadTankSize();
    const width = size?.width ?? null;
    const height = size?.height ?? null;
    return {
      instances: storage.loadInstances(),
      groups: storage.loadGroups(),
      roomInstances: storage.loadRoomInstances(width ?? TANK_FALLBACK.width, height ?? TANK_FALLBACK.height),
      width,
      height,
      shape: storage.loadTankShape() ?? 'rectangle',
      cornerRadiusFrac: storage.loadTankShapeParam(storage.KEY_TANK_CORNER_RADIUS_FRAC) ?? 0.22,
      ovalTopCutFrac: storage.loadTankShapeParam(storage.KEY_TANK_OVAL_TOP_CUT_FRAC) ?? 0.28,
      backgroundSpriteId: storage.loadTankBackgroundSpriteId(),
      backgroundTransform: storage.loadTankBackgroundTransform() ?? { x: 0, y: 0, scale: 1, rotation: 0 },
      waterLevel: storage.loadTankWaterLevel() ?? 1,
      algae: storage.loadTankAlgae() ?? 0,
      lastTickAt: storage.loadTankLastTick(),
    };
  }

  async saveTankState(state: TankState): Promise<void> {
    storage.saveInstances(state.instances);
    storage.saveGroups(state.groups);
    storage.saveRoomInstances(state.roomInstances);
    storage.saveTankSize({ width: state.width ?? TANK_FALLBACK.width, height: state.height ?? TANK_FALLBACK.height });
    storage.saveTankShape(state.shape);
    storage.saveTankShapeParam(storage.KEY_TANK_CORNER_RADIUS_FRAC, state.cornerRadiusFrac);
    storage.saveTankShapeParam(storage.KEY_TANK_OVAL_TOP_CUT_FRAC, state.ovalTopCutFrac);
    storage.saveTankBackgroundSpriteId(state.backgroundSpriteId);
    storage.saveTankBackgroundTransform(state.backgroundTransform);
    storage.saveTankWaterLevel(state.waterLevel);
    storage.saveTankAlgae(state.algae);
    storage.saveTankLastTick(state.lastTickAt ?? Date.now());
  }

  async loadEditorPrefs(): Promise<EditorPrefs> {
    return {
      paletteColors: storage.loadPaletteColors(),
      savedColors: storage.loadSavedColors(),
      pinnedColors: storage.loadPinnedColors(),
      brushSizes: storage.loadBrushSizes(),
      canvasBackground: storage.loadCanvasBackground(),
      onion: storage.loadOnionSettings(),
    };
  }

  async saveEditorPrefs(patch: Partial<EditorPrefs>): Promise<void> {
    if (patch.paletteColors) storage.savePaletteColors(patch.paletteColors);
    if (patch.savedColors) storage.saveSavedColors(patch.savedColors);
    if (patch.pinnedColors) storage.savePinnedColors(patch.pinnedColors);
    if (patch.brushSizes) storage.saveBrushSizes(patch.brushSizes);
    if (patch.canvasBackground) storage.saveCanvasBackground(patch.canvasBackground);
    if (patch.onion) storage.saveOnionSettings(patch.onion);
  }
}

export const SINGLE_TANK_ID = 'tank_local';

/** Only used when a tank has never been sized - kept here rather than imported from useTank.ts so the
 *  data layer does not depend on a hook. Mirrors TANK_SIZE_DEFAULT there. */
const TANK_FALLBACK = { width: 900, height: 600 };
