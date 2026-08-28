import { useState } from 'react';
import { Button } from '@/components/ui/8bit/button';
import { PixelEditorPanel } from '@/components/editor/PixelEditorPanel';
import { TankPanel } from '@/components/tank/TankPanel';

type Tab = 'editor' | 'tank';

export default function App() {
  const [tab, setTab] = useState<Tab>('editor');

  return (
    <div id="app">
      <header className="app-header">
        <h1>
          <i className="fa-solid fa-fish" /> Pixel Fish Tank
        </h1>
        <nav className="tabs">
          <Button type="button" variant={tab === 'editor' ? 'default' : 'secondary'} onClick={() => setTab('editor')}>
            <i className="fa-solid fa-palette" /> วาดปลา/ของตกแต่ง
          </Button>
          <Button type="button" variant={tab === 'tank' ? 'default' : 'secondary'} onClick={() => setTab('tank')}>
            <i className="fa-solid fa-water" /> ตู้ปลา
          </Button>
        </nav>
      </header>

      <main>
        <section className="tab-panel" hidden={tab !== 'editor'}>
          <PixelEditorPanel active={tab === 'editor'} />
        </section>
        <section className="tab-panel" hidden={tab !== 'tank'}>
          <TankPanel active={tab === 'tank'} />
        </section>
      </main>
    </div>
  );
}
