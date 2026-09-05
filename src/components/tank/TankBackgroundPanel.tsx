import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/lib/i18n';
import type { TankEngine } from '@/hooks/useTank';
import { PaletteThumb } from './TankPalette';

export function TankBackgroundPanel({ engine }: { engine: TankEngine }) {
  const { t } = useLanguage();
  const backgrounds = engine.sprites.filter((s) => s.type === 'background');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // The on-canvas move/resize/rotate handles (see TankEngine.backgroundEditing) are only meaningful
  // while this tab is the one showing - turned off on unmount so switching to Layers/Sprites doesn't
  // leave a stale transform box intercepting clicks meant for placing/selecting fish.
  useEffect(() => {
    engine.setBackgroundEditing(true);
    return () => engine.setBackgroundEditing(false);
  }, [engine]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Cleared unconditionally (not just on success) so picking the same file again after a failed
    // attempt still fires a fresh change event instead of silently no-opping.
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      await engine.addBackgroundFromImage(file);
    } catch (err) {
      console.warn('addBackgroundFromImage failed', err);
      alert(t('tank.backgroundUploadError'));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="tank-palette">
      <p className="palette-hint">{t('tank.backgroundHint')}</p>
      <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleFileChange} />
      <Button type="button" size="sm" variant="secondary" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
        <i className={`fa-solid ${uploading ? 'fa-spinner fa-spin' : 'fa-upload'}`} />
        {uploading ? t('tank.backgroundUploading') : t('tank.backgroundUpload')}
      </Button>
      <div className="tank-palette-list">
        <div
          className={`tank-palette-item tank-bg-item${engine.backgroundSpriteId === null ? ' active' : ''}`}
          onClick={() => engine.setTankBackgroundSprite(null)}
        >
          <div className="tank-bg-thumb tank-bg-thumb-default" />
          <span className="tank-palette-item-name">{t('tank.backgroundDefault')}</span>
        </div>
        {backgrounds.map((sprite) => (
          <div
            key={sprite.id}
            className={`tank-palette-item tank-bg-item${engine.backgroundSpriteId === sprite.id ? ' active' : ''}`}
            onClick={() => engine.setTankBackgroundSprite(sprite.id)}
          >
            <PaletteThumb sprite={sprite} />
            <span className="tank-palette-item-name" title={sprite.name}>
              {sprite.name}
            </span>
          </div>
        ))}
      </div>
      {backgrounds.length === 0 && <p className="palette-hint">{t('tank.backgroundEmpty')}</p>}
    </div>
  );
}
