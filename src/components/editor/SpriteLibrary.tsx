import { useMemo, useState } from 'react';
import { GalleryDialog } from '@/components/editor/GalleryDialog';
import { SpriteThumb } from '@/components/PixelThumb';
import { useAuth } from '@/hooks/useAuth';
import { setSpriteVisibility } from '@/lib/data/gallery';
import { useLanguage } from '@/lib/i18n';
import type { Sprite, SpriteType } from '@/lib/types';
import type { PixelEditorEngine } from '@/hooks/usePixelEditor';

const THUMB_PX = 48;

/** Tab order, plus the icon and label key each type carries elsewhere in the UI. */
const TYPE_TABS: { type: SpriteType; icon: string; key: string }[] = [
  { type: 'fish', icon: 'fish', key: 'library.tabFish' },
  { type: 'object', icon: 'leaf', key: 'library.tabObject' },
  { type: 'room', icon: 'image', key: 'library.tabRoom' },
  { type: 'background', icon: 'water', key: 'library.tabBackground' },
];

const TYPE_ICON: Record<SpriteType, string> = { fish: 'fish', object: 'leaf', room: 'image', background: 'water' };

function LibraryThumb({ sprite }: { sprite: Sprite }) {
  return <SpriteThumb sprite={sprite} size={THUMB_PX} />;
}

/**
 * The saved-sprite library, docked along the bottom by default (see useEditorLayout) where a wide row
 * of thumbnails fits. Split by sprite type into tabs with counts rather than one undifferentiated grid:
 * once someone has drawn a couple of dozen fish, finding the one background among them meant scanning
 * every card, and the type was only readable from a small icon on each label.
 */
export function SpriteLibrary({
  engine,
  onConfirmDiscard,
  onError,
}: {
  engine: PixelEditorEngine;
  onConfirmDiscard: () => boolean;
  onError: (msg: string) => void;
}) {
  const { t } = useLanguage();
  const { session, available } = useAuth();
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [publishing, setPublishing] = useState<string | null>(null);
  const [tab, setTab] = useState<SpriteType | 'all'>('all');

  const counts = useMemo(() => {
    const map = { fish: 0, object: 0, room: 0, background: 0 } as Record<SpriteType, number>;
    engine.sprites.forEach((s) => {
      if (map[s.type] !== undefined) map[s.type] += 1;
    });
    return map;
  }, [engine.sprites]);

  const shown = tab === 'all' ? engine.sprites : engine.sprites.filter((s) => s.type === tab);

  const togglePublished = async (sprite: Sprite) => {
    setPublishing(sprite.id);
    try {
      await setSpriteVisibility(sprite, sprite.visibility === 'public' ? 'private' : 'public');
      // The repository wrote it; the editor's own copy of the library is refreshed the same way a sync
      // refreshes it, so the badge updates without a reload.
      window.dispatchEvent(new CustomEvent('ft:sprites-updated'));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setPublishing(null);
    }
  };

  return (
    <div className="library">
      <div className="library-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          className="library-tab"
          aria-selected={tab === 'all'}
          data-active={tab === 'all' || undefined}
          onClick={() => setTab('all')}
        >
          {t('library.tabAll')} <span className="library-tab-count">{engine.sprites.length}</span>
        </button>
        {TYPE_TABS.map(({ type, icon, key }) => (
          <button
            key={type}
            type="button"
            role="tab"
            className="library-tab"
            aria-selected={tab === type}
            data-active={tab === type || undefined}
            // A type nobody has drawn yet is shown but not selectable: keeping the row of tabs fixed
            // means they never shuffle under the pointer as sprites are saved and deleted.
            disabled={counts[type] === 0}
            onClick={() => setTab(type)}
          >
            <i className={`fa-solid fa-${icon}`} aria-hidden="true" /> {t(key)}{' '}
            <span className="library-tab-count">{counts[type]}</span>
          </button>
        ))}
        {available && (
          <button type="button" className="library-tab library-gallery-tab" onClick={() => setGalleryOpen(true)}>
            <i className="fa-solid fa-images" aria-hidden="true" /> {t('gallery.open')}
          </button>
        )}
      </div>
      <div className="library-grid">
        <button
          type="button"
          className="library-add"
          title={t('form.new')}
          onClick={() => engine.newSprite(onConfirmDiscard)}
        >
          <i className="fa-solid fa-plus" />
        </button>
        {shown.map((sprite) => (
          <div key={sprite.id} className="library-card" onClick={() => engine.loadSpriteForEdit(sprite, onConfirmDiscard)}>
            <LibraryThumb sprite={sprite} />
            <div className="library-label">
              <i className={`fa-solid fa-${TYPE_ICON[sprite.type] ?? 'leaf'}`} /> {sprite.name}
            </div>
            <button
              type="button"
              className="library-del"
              onClick={(e) => {
                e.stopPropagation();
                engine.deleteSprite(sprite.id, () => confirm(t('library.deleteConfirm')), onError);
              }}
            >
              <i className="fa-solid fa-xmark" />
            </button>
            {/* Publishing needs an account, so the control only appears once there is one to publish
                to - an offer nobody can accept is worse than no offer. */}
            {session && (
              <button
                type="button"
                className={`library-publish${sprite.visibility === 'public' ? ' is-public' : ''}`}
                disabled={publishing === sprite.id}
                title={sprite.visibility === 'public' ? t('gallery.unpublishTitle') : t('gallery.publishTitle')}
                onClick={(e) => {
                  e.stopPropagation();
                  void togglePublished(sprite);
                }}
              >
                <i className={`fa-solid fa-${sprite.visibility === 'public' ? 'earth-asia' : 'lock'}`} />
              </button>
            )}
          </div>
        ))}
        {shown.length === 0 && <p className="library-empty">{t('library.empty')}</p>}
      </div>
      <GalleryDialog open={galleryOpen} onClose={() => setGalleryOpen(false)} onError={onError} />
    </div>
  );
}
