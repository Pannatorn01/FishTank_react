import { useCallback, useEffect, useState } from 'react';
import { loadUiTheme, saveUiTheme } from '@/lib/storage';
import type { UiTheme } from '@/lib/types';

/**
 * Swatch colors for the theme picker. Can't just read var(--pixel-bg)/var(--pixel-accent) for
 * each option - those are scoped to whichever [data-theme] is active on <html> right now, not to
 * the theme a given dropdown option represents - so the picker needs its own small copy of each
 * palette's two most representative colors (kept in sync with the [data-theme] blocks in index.css).
 */
export const THEME_PREVIEW: Record<UiTheme, { bg: string; accent: string }> = {
  cottonCandy: { bg: '#fbeff6', accent: '#ff8fab' },
  watermelonCandy: { bg: '#ffedf0', accent: '#ff5c77' },
  caramel: { bg: '#fff3e6', accent: '#ffa45c' },
  lemonCake: { bg: '#fffbe6', accent: '#ffd93d' },
  matcha: { bg: '#eafbf3', accent: '#4fcb82' },
  blueberryMuffin: { bg: '#e8ecfb', accent: '#6b5fd1' },
  ube: { bg: '#f3ebfa', accent: '#9b4fe0' },
  blackSesame: { bg: '#14121f', accent: '#7c5cff' },
  vanilla: { bg: '#faf7f0', accent: '#c89666' },
};

export function useUiTheme() {
  const [theme, setThemeState] = useState<UiTheme>(() => loadUiTheme() ?? 'cottonCandy');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setTheme = useCallback((next: UiTheme) => {
    setThemeState(next);
    saveUiTheme(next);
  }, []);

  return { theme, setTheme };
}
