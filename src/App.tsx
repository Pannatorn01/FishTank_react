import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { PixelEditorPanel } from '@/components/editor/PixelEditorPanel';
import { TankPanel } from '@/components/tank/TankPanel';
import { usePixelEditor } from '@/hooks/usePixelEditor';
import { useLanguage } from '@/lib/i18n';
import type { SpriteType } from '@/lib/types';

type Tab = 'editor' | 'tank';

export default function App() {
  const [tab, setTab] = useState<Tab>('editor');
  const { lang, setLang, t } = useLanguage();
  const engine = usePixelEditor();
  const [name, setName] = useState(engine.current.name);
  const [type, setType] = useState<SpriteType>(engine.current.type);

  useEffect(() => {
    setName(engine.current.name);
    setType(engine.current.type);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.loadToken]);

  const onError = (msg: string) => alert(msg);

  return (
    <div id="app">
      <header className="app-header">
        <h1>
          <i className="fa-solid fa-fish" /> Pixel Fish Tank
        </h1>
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
            <Button type="button" size="sm" onClick={() => engine.saveCurrentSprite(name, type, onError)}>
              <i className="fa-solid fa-floppy-disk" /> {t('form.save')}
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => engine.newSprite(() => confirm(t('confirm.discard')))}>
              <i className="fa-solid fa-file" /> {t('form.new')}
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => engine.exportFramePng()}>
              <i className="fa-solid fa-download" /> {t('form.exportPng')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              title={t('form.exportSheetTitle')}
              onClick={() => engine.exportSpriteSheetPng()}
            >
              <i className="fa-solid fa-download" /> {t('form.exportSheet')}
            </Button>
          </nav>
        )}
        <nav className="lang-switch">
          <Button type="button" size="sm" variant={lang === 'th' ? 'default' : 'secondary'} onClick={() => setLang('th')}>
            ไทย
          </Button>
          <Button type="button" size="sm" variant={lang === 'en' ? 'default' : 'secondary'} onClick={() => setLang('en')}>
            EN
          </Button>
        </nav>
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
