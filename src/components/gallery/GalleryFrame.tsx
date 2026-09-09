import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/lib/i18n';

/**
 * The chrome both gallery dialogs sit inside: the modal backdrop and panel, the titled header with its
 * close button, the three mutually exclusive "nothing to show yet" lines, the load-more button, and the
 * report form. Only what fills the middle - a grid of sprite cards, a list of tank rows - differs, and
 * that is `children`.
 *
 * The empty states are three separate cases on purpose: no Supabase project configured at all, a page
 * still in flight, and a page that came back with nothing. They mean different things to whoever is
 * looking, and collapsing them into one "nothing here" would hide a misconfiguration behind what reads
 * as an ordinary empty gallery.
 */
export function GalleryFrame({
  title,
  icon,
  onClose,
  available,
  loading,
  empty,
  emptyText,
  more,
  onLoadMore,
  report,
  children,
}: {
  title: string;
  /** Font Awesome icon name, without the `fa-` prefix. */
  icon: string;
  onClose: () => void;
  /** Whether there is a Supabase project to browse at all. */
  available: boolean;
  loading: boolean;
  empty: boolean;
  emptyText: string;
  more: boolean;
  onLoadMore: () => void;
  /** The report form, when one is open - `name` is the thing being reported. */
  report: {
    name: string;
    reason: string;
    onReasonChange: (reason: string) => void;
    onCancel: () => void;
    onSubmit: () => void;
  } | null;
  children: ReactNode;
}) {
  const { t } = useLanguage();
  return (
    <div className="gallery-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="gallery-panel">
        <header className="gallery-header">
          <h2>
            <i className={`fa-solid fa-${icon}`} aria-hidden="true" /> {title}
          </h2>
          <Button type="button" size="sm" variant="secondary" onClick={onClose}>
            {t('gallery.close')}
          </Button>
        </header>

        {!available && <p className="gallery-hint">{t('gallery.needsProject')}</p>}
        {available && loading && <p className="gallery-hint">{t('gallery.loading')}</p>}
        {available && empty && <p className="gallery-hint">{emptyText}</p>}

        {children}

        {more && (
          <div className="gallery-more">
            <Button type="button" size="sm" variant="secondary" onClick={onLoadMore}>
              {t('gallery.loadMore')}
            </Button>
          </div>
        )}

        {report && (
          <div className="gallery-report-form">
            <p>{t('gallery.reportBody', { name: report.name })}</p>
            <Input
              value={report.reason}
              placeholder={t('gallery.reportPlaceholder')}
              onChange={(e) => report.onReasonChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && report.onSubmit()}
            />
            <div className="gallery-report-actions">
              <Button type="button" size="sm" variant="secondary" onClick={report.onCancel}>
                {t('gallery.cancel')}
              </Button>
              <Button type="button" size="sm" onClick={report.onSubmit}>
                {t('gallery.reportSend')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The flag button on one gallery entry. Reporting writes something that has to belong to someone, so it
 * needs an account - signed out, the button is disabled and says why rather than disappearing, which
 * would leave no sign that reporting is possible at all.
 */
export function ReportButton({
  signedIn,
  reported,
  onClick,
}: {
  signedIn: boolean;
  reported: boolean;
  onClick: () => void;
}) {
  const { t } = useLanguage();
  return (
    <button
      type="button"
      className="gallery-report"
      disabled={!signedIn || reported}
      title={signedIn ? t('gallery.report') : t('gallery.needsAccount')}
      onClick={onClick}
    >
      <i className="fa-solid fa-flag" aria-hidden="true" /> {reported ? t('gallery.reported') : t('gallery.report')}
    </button>
  );
}
