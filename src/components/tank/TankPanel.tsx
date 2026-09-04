import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useTank } from '@/hooks/useTank';
import { useLanguage } from '@/lib/i18n';
import { TankBackgroundPanel } from './TankBackgroundPanel';
import { TankCanvas } from './TankCanvas';
import { TankLayers } from './TankLayers';
import { TankPalette } from './TankPalette';

type SidebarTab = 'layers' | 'palette' | 'background';

export function TankPanel({ active }: { active: boolean }) {
  const engine = useTank();
  const { t } = useLanguage();
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('layers');

  useEffect(() => {
    const onSpritesUpdated = () => engine.refreshPalette();
    const onSpriteDeleted = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail.id;
      engine.removeInstancesBySprite(id);
    };
    window.addEventListener('ft:sprites-updated', onSpritesUpdated);
    window.addEventListener('ft:sprite-deleted', onSpriteDeleted);
    return () => {
      window.removeEventListener('ft:sprites-updated', onSpritesUpdated);
      window.removeEventListener('ft:sprite-deleted', onSpriteDeleted);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    engine.setActive(active);
    if (active) {
      engine.resizeCanvas();
      engine.refreshPalette();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return (
    <div className="tank-layout">
      <TankCanvas engine={engine} />
      <div className="tank-sidebar">
        <div className="tank-sidebar-tabs">
          <Button
            type="button"
            size="sm"
            variant={sidebarTab === 'layers' ? 'default' : 'secondary'}
            onClick={() => setSidebarTab('layers')}
          >
            <i className="fa-solid fa-layer-group" /> {t('tank.tabLayers')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={sidebarTab === 'palette' ? 'default' : 'secondary'}
            onClick={() => setSidebarTab('palette')}
          >
            <i className="fa-solid fa-fish" /> {t('tank.tabPalette')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={sidebarTab === 'background' ? 'default' : 'secondary'}
            onClick={() => setSidebarTab('background')}
          >
            <i className="fa-solid fa-image" /> {t('tank.tabBackground')}
          </Button>
        </div>
        {sidebarTab === 'layers' ? (
          <TankLayers engine={engine} />
        ) : sidebarTab === 'palette' ? (
          <TankPalette engine={engine} />
        ) : (
          <TankBackgroundPanel engine={engine} />
        )}
      </div>
    </div>
  );
}
