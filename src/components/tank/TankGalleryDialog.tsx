import { Button } from '@/components/ui/button';
import { GalleryFrame, ReportButton } from '@/components/gallery/GalleryFrame';
import { useContentReport, useGalleryPage } from '@/components/gallery/useGallery';
import { useAuth } from '@/hooks/useAuth';
import { listTankGallery, type GalleryTank } from '@/lib/data/gallery';
import { useLanguage } from '@/lib/i18n';

const entryId = (entry: GalleryTank) => entry.id;

/**
 * Tanks other people have published, and the two things anyone can do with one: look at it, or report
 * it.
 *
 * Deliberately not a copy button. A sprite is a drawing and copying one is obvious; a tank is a place
 * somebody keeps their fish, and dropping a duplicate of it into your account would be a strange thing
 * to offer - the fish in it are not yours, and the sprites they use belong to their author's library,
 * not to the tank. Someone who wants a fish they saw copies it from the sprite gallery, where copying
 * is what the whole screen is for.
 *
 * Opening dispatches the same event the "shared with you" list uses, so a public tank and a tank
 * shared directly with you land in exactly the same read-only view (SharedTankView).
 */
export function TankGalleryDialog({ open, onClose, onError }: { open: boolean; onClose: () => void; onError: (msg: string) => void }) {
  const { t } = useLanguage();
  const { session, available } = useAuth();

  const { items, more, loadMore } = useGalleryPage(open, listTankGallery, onError);
  const report = useContentReport('tank', entryId, onError);

  if (!open) return null;

  const openTank = (entry: GalleryTank) => {
    onClose();
    window.dispatchEvent(new CustomEvent('ft:open-shared-tank', { detail: { tankId: entry.id } }));
  };

  return (
    <GalleryFrame
      title={t('tankGallery.title')}
      icon="water"
      onClose={onClose}
      available={available}
      loading={items === null}
      empty={items?.length === 0}
      emptyText={t('tankGallery.empty')}
      more={more}
      onLoadMore={loadMore}
      report={
        report.reporting && {
          name: report.reporting.name,
          reason: report.reason,
          onReasonChange: report.setReason,
          onCancel: report.cancel,
          onSubmit: () => void report.submit(),
        }
      }
    >
      {!!items?.length && (
        <ul className="tank-gallery-list">
          {items.map((entry) => (
            <li key={entry.id} className="tank-gallery-row">
              <span className="tank-gallery-name" title={entry.name}>
                {entry.name}
              </span>
              <span className="tank-gallery-count">{t('tankGallery.fishCount', { n: entry.fishCount })}</span>
              <Button type="button" size="sm" onClick={() => openTank(entry)}>
                <i className="fa-solid fa-eye" aria-hidden="true" /> {t('tankGallery.open')}
              </Button>
              <ReportButton
                signedIn={!!session}
                reported={report.hasReported(entry)}
                onClick={() => report.begin(entry)}
              />
            </li>
          ))}
        </ul>
      )}
    </GalleryFrame>
  );
}
