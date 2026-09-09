import { Suspense, lazy, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PixelEditorPanel } from '@/components/editor/PixelEditorPanel';
import { AccountMenu } from '@/components/AccountMenu';
import { StorageBanner } from '@/components/StorageBanner';
import { SyncStatusChip } from '@/components/SyncStatusChip';

// Lazy: TankSection pulls in the tank simulation engine, canvas render loop, and GIF/video export
// (gifenc) - a meaningful slice of the ~550kB bundle (see docs/EDITOR_IMPROVEMENTS.md #12) that
// someone who only ever uses the pixel editor shouldn't have to download at all. Once loaded it owns
// both Build mode (TankPanel) and Life mode (LifePanel, added P4 - see
// docs/PIXI_MIGRATION_PLAN.md §14) behind one `useTank()` engine instance, so the two modes always
// agree on what's actually in the tank instead of each holding an independent copy. Every mode's
// panel used to stay mounted unconditionally so the tank's own imperative engine (a running
// requestAnimationFrame loop, instance state) survives switching tabs - see the `hasVisitedTank` gate
// below for how that's preserved while still deferring the import/mount until Build or Life is opened
// at least once.
const TankSection = lazy(() => import('@/components/tank/TankSection').then((m) => ({ default: m.TankSection })));
// Lazy for the same reason, plus one of its own: most sessions never open somebody else's tank, and
// the ones that do arrive on a link and can afford one more chunk.
const SharedTankView = lazy(() => import('@/components/tank/SharedTankView').then((m) => ({ default: m.SharedTankView })));
import { useEditorLayout } from '@/hooks/useEditorLayout';
import { usePixelEditor } from '@/hooks/usePixelEditor';
import { UI_SCALES, useUiScale, type UiScale } from '@/hooks/useUiScale';
import { THEME_PREVIEW, useUiTheme } from '@/hooks/useUiTheme';
import { shareTargetFromUrl } from '@/lib/data/sharing';
import { useLanguage } from '@/lib/i18n';
import { UI_THEMES } from '@/lib/storage';
import type { SpriteType, UiTheme } from '@/lib/types';

type Tab = 'editor' | 'tank' | 'life';

export default function App() {
  const [tab, setTab] = useState<Tab>('editor');
  // Set when the page was opened from a share link, or when the share panel asks to open a tank
  // somebody shared. While it is set the app shows that tank instead of the user's own - it is a
  // different person's work, and mixing it into the same tabs is how the two get confused.
  const [shared, setShared] = useState(() => shareTargetFromUrl());

  useEffect(() => {
    const onOpenShared = (e: Event) => {
      setShared({ tankId: (e as CustomEvent<{ tankId: string }>).detail.tankId, slug: null });
    };
    window.addEventListener('ft:open-shared-tank', onOpenShared);
    return () => window.removeEventListener('ft:open-shared-tank', onOpenShared);
  }, []);

  // Closing takes the tank out of the address bar too, so a reload (or a shared browser session) does
  // not drop the user straight back into somebody else's tank.
  const closeShared = () => {
    setShared(null);
    window.history.replaceState(null, '', window.location.pathname);
  };

  // Once true, stays true - TankSection keeps its own running engine/animation loop alive across tab
  // switches (see this file's Suspense boundary comment), so it must never unmount after first visit.
  const [hasVisitedTank, setHasVisitedTank] = useState(false);
  useEffect(() => {
    if (tab === 'tank' || tab === 'life') setHasVisitedTank(true);
  }, [tab]);
  const { t } = useLanguage();
  const { theme, setTheme } = useUiTheme();
  const { scale, setScale } = useUiScale();
  const engine = usePixelEditor();
  const layoutApi = useEditorLayout();
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
            <SyncStatusChip />
            <AccountMenu />
            <Select value={scale} onValueChange={(v) => setScale(v as UiScale)}>
              <SelectTrigger className="ui-scale-trigger text-xs" size="sm" title={t('scale.title')}>
                <SelectValue>
                  <i className="fa-solid fa-magnifying-glass" aria-hidden="true" /> {t(`scale.${scale}`)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="end" position="popper">
                {UI_SCALES.map((id) => (
                  <SelectItem key={id} value={id}>
                    {t(`scale.${id}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
        {/* Hidden while someone else's tank is open: those tabs act on the user's own work, and a tab
            bar that appears to do nothing is worse than one that is not there. */}
        <div className="toolbar-row" hidden={!!shared}>
          <nav className="tabs">
            <Button type="button" variant={tab === 'editor' ? 'default' : 'secondary'} onClick={() => setTab('editor')}>
              <i className="fa-solid fa-palette" /> {t('tab.editor')}
            </Button>
            <Button type="button" variant={tab === 'tank' ? 'default' : 'secondary'} onClick={() => setTab('tank')}>
              <i className="fa-solid fa-water" /> {t('tab.tank')}
            </Button>
            <Button type="button" variant={tab === 'life' ? 'default' : 'secondary'} onClick={() => setTab('life')}>
              <i className="fa-solid fa-house" /> {t('tab.life')}
            </Button>
          </nav>
          {tab === 'editor' && (
            <nav className="header-editor-actions">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                title={t('dock.resetLayout')}
                onClick={() => layoutApi.resetLayout()}
              >
                <i className="fa-solid fa-table-columns" />
                {t('dock.resetLayoutShort')}
              </Button>
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
      <StorageBanner readOnly={engine.readOnly} />

      {shared ? (
        <main>
          <Suspense fallback={<p className="tab-panel-loading">{t('app.loading')}</p>}>
            {/* Keyed so opening a different shared tank mounts a fresh view rather than reusing this
                one - which is what lets SharedTankView start at 'loading' without resetting itself in
                an effect (and showing the previous tank for a frame while it does). */}
            <SharedTankView
              key={`${shared.tankId}|${shared.slug ?? ''}`}
              tankId={shared.tankId}
              slug={shared.slug}
              onClose={closeShared}
            />
          </Suspense>
        </main>
      ) : (
      <main>
        {/* Storage is asynchronous now (src/lib/data), so there is a moment - a microtask today, a
            network round-trip once there is a server - where the engine is constructed but empty.
            Showing the editor then would show an empty library, which reads as "all my work is gone".
            See PixelEditorEngine.hydrate(). */}
        {!engine.ready && <p className="tab-panel-loading">{t('app.loading')}</p>}
        <section className="tab-panel" hidden={tab !== 'editor' || !engine.ready}>
          <PixelEditorPanel
            engine={engine}
            name={name}
            setName={setName}
            type={type}
            setType={setType}
            active={tab === 'editor'}
            layoutApi={layoutApi}
          />
        </section>
        <section className="tab-panel" hidden={(tab !== 'tank' && tab !== 'life') || !engine.ready}>
          {hasVisitedTank && engine.ready && (
            <Suspense fallback={<p className="tab-panel-loading">{t('app.loading')}</p>}>
              <TankSection mode={tab === 'life' ? 'life' : 'build'} active={tab === 'tank' || tab === 'life'} />
            </Suspense>
          )}
        </section>
      </main>
      )}
    </div>
  );
}
