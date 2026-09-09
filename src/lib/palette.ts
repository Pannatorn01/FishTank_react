import { getRepos } from './data';

/** A couple of built-in underwater-themed preset palettes for the top palette row (see
 *  `applyPreset`/ColorPalette.tsx) - a quick starting point distinct from a user's own saved colors,
 *  not persisted themselves (only the result of applying one, via `palette`, is). */
export const PRESET_PALETTES: Record<string, string[]> = {
  Reef: ['#0b1d2a', '#123a4d', '#1f7a8c', '#2ec4b6', '#8ee3ef', '#f6f7f8', '#ffbf69', '#ff7f51', '#d64550', '#8a3033'],
  Deep: ['#05070f', '#0d1b2a', '#1b263b', '#2a3d5c', '#415a77', '#778da9', '#a9c0d6', '#e0e1dd', '#c9ada7', '#9a8c98'],
};

export const DEFAULT_PALETTE_COLORS = [
  '#000000', '#ffffff', '#ff4d4d', '#4dd2ff', '#4dff88', '#ffd24d', '#b34dff', '#ff8c1a', '#8c8c8c', '#4d79ff',
];

/**
 * The colors on offer in the editor, and which of them are remembered.
 *
 * Three separate lists, because they answer three different questions. `palette` is the fixed top row -
 * a starting point, overwritten wholesale by a preset. `saved` is the artist's own growing list, added
 * to automatically as colors get used. `pinned` marks the saved colors that survive a cleanup even when
 * the current sprite does not use them - the reason `clearUnused` can be a one-click action instead of a
 * confirmation dialog.
 *
 * Every mutation persists immediately through the prefs repository and then notifies: these are small
 * writes, and losing a color because the tab closed before some later flush would be worse than the
 * write itself.
 */
export class Palette {
  palette: string[] = [];
  saved: string[] = [];
  pinned: Set<string> = new Set();

  private readonly notify: () => void;

  constructor(notify: () => void) {
    this.notify = notify;
  }

  /** Fills from stored prefs. A user who has never applied a preset has no stored palette row at all,
   *  which is what the default stands in for - distinct from having deliberately emptied it. */
  hydrate(prefs: { paletteColors: string[] | null; savedColors: string[]; pinnedColors: string[] }): void {
    this.palette = prefs.paletteColors ?? [...DEFAULT_PALETTE_COLORS];
    this.saved = prefs.savedColors;
    this.pinned = new Set(prefs.pinnedColors);
  }

  private persist(patch: { paletteColors?: string[]; savedColors?: string[]; pinnedColors?: string[] }): void {
    getRepos().prefs.set(patch);
    this.notify();
  }

  removeFromPalette(color: string): void {
    if (!this.palette.includes(color)) return;
    this.palette = this.palette.filter((c) => c !== color);
    this.persist({ paletteColors: this.palette });
  }

  /** Overwrites the top (fixed-position) palette row with one of PRESET_PALETTES - a quick
   *  underwater-themed starting point, distinct from the user's own growing saved list. */
  applyPreset(name: string): void {
    const preset = PRESET_PALETTES[name];
    if (!preset) return;
    this.palette = [...preset];
    this.persist({ paletteColors: this.palette });
  }

  addSaved(color: string): void {
    if (this.saved.includes(color)) return;
    this.saved = [...this.saved, color];
    this.persist({ savedColors: this.saved });
  }

  removeSaved(color: string): void {
    if (!this.saved.includes(color)) return;
    this.saved = this.saved.filter((c) => c !== color);
    // A color that is gone cannot stay pinned - leaving the pin behind would silently re-protect the
    // color if it were ever saved again.
    if (this.pinned.has(color)) {
      const next = new Set(this.pinned);
      next.delete(color);
      this.pinned = next;
      getRepos().prefs.set({ pinnedColors: [...next] });
    }
    this.persist({ savedColors: this.saved });
  }

  isPinned(color: string): boolean {
    return this.pinned.has(color);
  }

  togglePin(color: string): void {
    const next = new Set(this.pinned);
    if (next.has(color)) next.delete(color);
    else next.add(color);
    this.pinned = next;
    this.persist({ pinnedColors: [...next] });
  }

  /** Drag-to-reorder for the saved-colors row (see ColorPalette.tsx) - the same splice-and-reinsert
   *  shape as moving a layer or a frame. */
  reorderSaved(from: number, to: number): void {
    if (from === to || from < 0 || to < 0 || from >= this.saved.length || to >= this.saved.length) return;
    const next = [...this.saved];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    this.saved = next;
    this.persist({ savedColors: this.saved });
  }

  /** Drops every saved color that is neither pinned nor in `used` - a one-click way to prune a list
   *  that otherwise only ever grows. The caller supplies `used` because what counts as "in use" is a
   *  question about the sprite, which this class deliberately knows nothing about. */
  clearUnused(used: ReadonlySet<string>): void {
    const next = this.saved.filter((c) => this.pinned.has(c) || used.has(c));
    if (next.length === this.saved.length) return;
    this.saved = next;
    this.persist({ savedColors: this.saved });
  }
}
