import { useCallback, useEffect, useState } from 'react';
import { KEY_UI_SCALE } from '@/lib/storage';

/**
 * How large the whole editor draws. Everything in the UI is sized in rem, so one root font size scales
 * the lot - panels, buttons, labels, the docks' minimum widths - without a single component knowing
 * about it. The app used to hard-code 130% (20.8px) on <html>, which is comfortable on a small laptop
 * and enormous on a big monitor, with no way to say so; this makes it a setting, and starts at the
 * browser's own default instead.
 */
export type UiScale = 'compact' | 'normal' | 'large' | 'huge';

export const UI_SCALES: UiScale[] = ['compact', 'normal', 'large', 'huge'];

/** Root font size per step, as a percentage of the browser's default (usually 16px). */
export const UI_SCALE_PERCENT: Record<UiScale, number> = {
  compact: 85,
  normal: 100,
  large: 115,
  huge: 130,
};

/** See KEY_EDITOR_LAYOUT's note in useEditorLayout.ts - declared in storage.ts so backup/reset see it. */
const STORAGE_KEY = KEY_UI_SCALE;

function load(): UiScale {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return UI_SCALES.includes(raw as UiScale) ? (raw as UiScale) : 'normal';
  } catch {
    // Blocked or unreadable storage just means the default size, never a failure to render.
    return 'normal';
  }
}

export function useUiScale() {
  const [scale, setScaleState] = useState<UiScale>(load);

  useEffect(() => {
    document.documentElement.style.fontSize = `${UI_SCALE_PERCENT[scale]}%`;
  }, [scale]);

  const setScale = useCallback((next: UiScale) => {
    setScaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not being able to remember the choice is no reason to refuse to make it.
    }
  }, []);

  return { scale, setScale };
}
