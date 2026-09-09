import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { listTankGallery, reportContent, type GalleryTank } from '@/lib/data/gallery';
import { useLanguage } from '@/lib/i18n';

const PAGE = 60;

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
  const [items, setItems] = useState<GalleryTank[] | null>(null);
  const [reported, setReported] = useState<Set<string>>(new Set());
  const [reporting, setReporting] = useState<GalleryTank | null>(null);
  const [reason, setReason] = useState('');
  const [more, setMore] = useState(false);

  const load = useCallback(
    async (before?: string) => {
      try {
        const page = await listTankGallery(PAGE, before);
        setItems((prev) => (before && prev ? [...prev, ...page] : page));
        setMore(page.length === PAGE);
      } catch (e) {
        onError(e instanceof Error ? e.message : String(e));
        setItems([]);
      }
    },
    [onError]
  );

  useEffect(() => {
    if (!open) return;
    setItems(null);
    void load();
  }, [open, load]);

  if (!open) return null;

  const submitReport = async () => {
    if (!reporting) return;
    const entry = reporting;
    setReporting(null);
    try {
      await reportContent('tank', entry.id, reason.trim());
      setReported((prev) => new Set(prev).add(entry.id));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setReason('');
    }
  };

  const openTank = (entry: GalleryTank) => {
    onClose();
    window.dispatchEvent(new CustomEvent('ft:open-shared-tank', { detail: { tankId: entry.id } }));
  };

  return (
    <div className="gallery-backdrop" role="dialog" aria-modal="true" aria-label={t('tankGallery.title')}>
      <div className="gallery-panel">
        <header className="gallery-header">
          <h2>
            <i className="fa-solid fa-water" aria-hidden="true" /> {t('tankGallery.title')}
          </h2>
          <Button type="button" size="sm" variant="secondary" onClick={onClose}>
            {t('gallery.close')}
          </Button>
        </header>

        {!available && <p className="gallery-hint">{t('gallery.needsProject')}</p>}
        {available && items === null && <p className="gallery-hint">{t('gallery.loading')}</p>}
        {available && items?.length === 0 && <p className="gallery-hint">{t('tankGallery.empty')}</p>}

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
                <button
                  type="button"
                  className="gallery-report"
                  disabled={!session || reported.has(entry.id)}
                  title={session ? t('gallery.report') : t('gallery.needsAccount')}
                  onClick={() => {
                    setReason('');
                    setReporting(entry);
                  }}
                >
                  <i className="fa-solid fa-flag" aria-hidden="true" />{' '}
                  {reported.has(entry.id) ? t('gallery.reported') : t('gallery.report')}
                </button>
              </li>
            ))}
          </ul>
        )}

        {more && (
          <div className="gallery-more">
            <Button type="button" size="sm" variant="secondary" onClick={() => void load(items?.[items.length - 1]?.cursor)}>
              {t('gallery.loadMore')}
            </Button>
          </div>
        )}

        {reporting && (
          <div className="gallery-report-form">
            <p>{t('gallery.reportBody', { name: reporting.name })}</p>
            <Input
              value={reason}
              placeholder={t('gallery.reportPlaceholder')}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void submitReport()}
            />
            <div className="gallery-report-actions">
              <Button type="button" size="sm" variant="secondary" onClick={() => setReporting(null)}>
                {t('gallery.cancel')}
              </Button>
              <Button type="button" size="sm" onClick={() => void submitReport()}>
                {t('gallery.reportSend')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
