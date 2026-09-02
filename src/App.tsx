import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PixelEditorPanel } from '@/components/editor/PixelEditorPanel';
import { TankPanel } from '@/components/tank/TankPanel';
import { usePixelEditor } from '@/hooks/usePixelEditor';
import { THEME_PREVIEW, useUiTheme } from '@/hooks/useUiTheme';
import { useLanguage } from '@/lib/i18n';
import { UI_THEMES } from '@/lib/storage';
import type { SpriteType, UiTheme } from '@/lib/types';

type Tab = 'editor' | 'tank';

export default function App() {
  const [tab, setTab] = useState<Tab>('editor');
  const { t } = useLanguage();
  const { theme, setTheme } = useUiTheme();
  const engine = usePixelEditor();
  const [name, setName] = useState(engine.current.name);
  const [type, setType] = useState<SpriteType>(engine.current.type);

  useEffect(() => {
    setName(engine.current.name);
    setType(engine.current.type);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.loadToken]);

  return (
    <div id="app">
      <header className="app-header">
        <div className="title-bar">
          <h1 className="pixel-heading">
            <i className="fa-solid fa-fish" /> Pixel Fish Tank
          </h1>
          <div className="title-bar-actions">
            <Select value={theme} onValueChange={(v) => setTheme(v as UiTheme)}>
              <SelectTrigger className="theme-select-trigger text-xs" size="sm" title={t('theme.switch')}>
                <SelectValue>
                  <span
                    className="theme-swatch"
                    style={{ background: `linear-gradient(135deg, ${THEME_PREVIEW[theme].bg} 50%, ${THEME_PREVIEW[theme].accent} 50%)` }}
                    aria-hidden="true"
                  />
                  {t(`theme.${theme}`)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="end" position="popper">
                {UI_THEMES.map((id) => (
                  <SelectItem key={id} value={id}>
                    <span
                      className="theme-swatch"
                      style={{ background: `linear-gradient(135deg, ${THEME_PREVIEW[id].bg} 50%, ${THEME_PREVIEW[id].accent} 50%)` }}
                      aria-hidden="true"
                    />
                    {t(`theme.${id}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="title-bar-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          </div>
        </div>
        <div className="toolbar-row">
          <nav className="tabs">
            <Button type="button" variant={tab === 'editor' ? 'default' : 'secondary'} onClick={() => setTab('editor')}>
              <i className="fa-solid fa-palette" /> {t('tab.editor')}
            </Button>
            <Button type="button" variant={tab === 'tank' ? 'default' : 'secondary'} onClick={() => setTab('tank')}>
              <i className="fa-solid fa-water" /> {t('tab.tank')}
            </Button>
          </nav>
          {tab === 'editor' && (
            <nav className="header-editor-actions">
              <Button type="button" size="sm" variant="secondary" onClick={() => engine.exportFramePng()}>
                <i className="fa-solid fa-download" />
                 {t('form.exportPng')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                title={t('form.exportSheetTitle')}
                onClick={() => engine.exportSpriteSheetPng()}
              >
                <i className="fa-solid fa-download" />
                {t('form.exportSheet')}
              </Button>
            </nav>
          )}
        </div>
      </header>

      <main>
        <section className="tab-panel" hidden={tab !== 'editor'}>
          <PixelEditorPanel engine={engine} name={name} setName={setName} type={type} setType={setType} active={tab === 'editor'} />
        </section>
        <section className="tab-panel" hidden={tab !== 'tank'}>
          <TankPanel active={tab === 'tank'} />
        </section>
      </main>
    </div>
  );
}
