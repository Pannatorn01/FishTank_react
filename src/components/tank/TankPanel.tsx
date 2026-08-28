import { useEffect } from 'react';
import { useTank } from '@/hooks/useTank';
import { TankCanvas } from './TankCanvas';
import { TankPalette } from './TankPalette';

export function TankPanel({ active }: { active: boolean }) {
  const engine = useTank();

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
    if (active) {
      engine.resizeCanvas();
      engine.refreshPalette();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return (
    <div className="tank-layout">
      <TankCanvas engine={engine} />
      <TankPalette engine={engine} />
    </div>
  );
}
