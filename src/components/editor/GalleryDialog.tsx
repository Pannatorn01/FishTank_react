import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { SpriteThumb } from '@/components/PixelThumb';
import { GalleryFrame, ReportButton } from '@/components/gallery/GalleryFrame';
import { useContentReport, useGalleryPage } from '@/components/gallery/useGallery';
import { useAuth } from '@/hooks/useAuth';
import { forkGallerySprite, listGallery, type GallerySprite } from '@/lib/data/gallery';
import { useLanguage } from '@/lib/i18n';

const THUMB_PX = 64;

const entryId = (entry: GallerySprite) => entry.sprite.id;

/**
 * Sprites other people have published, and the two things anyone can do with one: take a copy, or
 * report it.
 *
 * The report button is not an afterthought sitting next to the copy button - it is the reason this
 * screen is allowed to exist at all (plan §4 P6.4/P6.5). Browsing works signed out; copying and
 * reporting need an account, because both write something that has to belong to someone.
 */
export function GalleryDialog({ open, onClose, onError }: { open: boolean; onClose: () => void; onError: (msg: string) => void }) {
  // The body is mounted only while the dialog is open, so every visit starts from a clean listing
  // and an empty 'already copied' set without anything having to reset itself.
  if (!open) return null;
  return <GalleryDialogBody onClose={onClose} onError={onError} />;
}

function GalleryDialogBody({ onClose, onError }: { onClose: () => void; onError: (msg: string) => void }) {
  const { t } = useLanguage();
  const { session, available } = useAuth();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());

  const { items, more, loadMore } = useGalleryPage(listGallery, onError);
  const report = useContentReport('sprite', entryId, onError);

  const fork = useCallback(
    async (entry: GallerySprite) => {
      setBusyId(entry.sprite.id);
      try {
        await forkGallerySprite(entry);
        setAdded((prev) => new Set(prev).add(entry.sprite.id));
      } catch (e) {
        onError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyId(null);
      }
    },
    [onError]
  );

  if (!open) return null;

  return (
    <GalleryFrame
      title={t('gallery.title')}
      icon="images"
      onClose={onClose}
      available={available}
      loading={items === null}
      empty={items?.length === 0}
      emptyText={t('gallery.empty')}
      more={more}
      onLoadMore={loadMore}
      report={
        report.reporting && {
          name: report.reporting.sprite.name,
          reason: report.reason,
          onReasonChange: report.setReason,
          onCancel: report.cancel,
          onSubmit: () => void report.submit(),
        }
      }
    >
      {!!items?.length && (
        <div className="gallery-grid">
          {items.map((entry) => (
            <div key={entry.sprite.id} className="gallery-card">
              <SpriteThumb sprite={entry.sprite} size={THUMB_PX} />
              <div className="gallery-name" title={entry.sprite.name}>
                {entry.sprite.name}
              </div>
              <div className="gallery-actions">
                <Button
                  type="button"
                  size="sm"
                  disabled={!session || busyId === entry.sprite.id || added.has(entry.sprite.id)}
                  title={session ? undefined : t('gallery.needsAccount')}
                  onClick={() => void fork(entry)}
                >
                  <i className="fa-solid fa-clone" aria-hidden="true" />{' '}
                  {added.has(entry.sprite.id) ? t('gallery.added') : t('gallery.copy')}
                </Button>
                <ReportButton
                  signedIn={!!session}
                  reported={report.hasReported(entry)}
                  onClick={() => report.begin(entry)}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </GalleryFrame>
  );
}
