import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { useTank, type TankSource } from '@/hooks/useTank';
import { reportContent } from '@/lib/data/gallery';
import { fetchSharedTank, type SharedTank } from '@/lib/data/sharing';
import { useLanguage } from '@/lib/i18n';
import { SharedTankCanvas } from './SharedTankCanvas';

/**
 * A tank someone else shared, opened from a link or from the "shared with you" list.
 *
 * The fetch happens here rather than inside the engine so the three answers a viewer can get - here it
 * is, it is still loading, you cannot see this one - are three things this component can say, instead
 * of an engine that has to represent "no tank" as an empty tank. An empty tank on screen is the one
 * thing this app has consistently refused to show (see App.tsx's `ready` gate), because it is
 * indistinguishable from work that has been lost.
 */
export function SharedTankView({ tankId, slug, onClose }: { tankId: string; slug: string | null; onClose: () => void }) {
  const { t } = useLanguage();
  const { session } = useAuth();
  const [tank, setTank] = useState<SharedTank | null | 'loading' | 'error'>('loading');
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);
  const [reason, setReason] = useState('');

  const submitReport = async (id: string) => {
    setReporting(false);
    try {
      await reportContent('tank', id, reason.trim());
      // Confirmed to the reporter and nothing more - not whether anyone else reported it, nor what
      // happened next. See reportContent.
      setReported(true);
    } catch (e) {
      console.warn('reporting a tank failed', e);
    } finally {
      setReason('');
    }
  };

  useEffect(() => {
    let cancelled = false;
    setTank('loading');
    void fetchSharedTank(tankId, slug)
      .then((result) => {
        if (!cancelled) setTank(result);
      })
      .catch((e) => {
        console.warn('opening a shared tank failed', e);
        if (!cancelled) setTank('error');
      });
    return () => {
      cancelled = true;
    };
  }, [tankId, slug]);

  return (
    <div className="shared-tank-view">
      <div className="shared-tank-bar">
        <Button type="button" size="sm" variant="secondary" onClick={onClose}>
          <i className="fa-solid fa-arrow-left" /> {t('share.backToMine')}
        </Button>
        <span className="shared-tank-title">
          {typeof tank === 'object' && tank ? tank.name : t('share.viewing')}
        </span>
        <span className="shared-tank-badge">
          <i className="fa-solid fa-eye" aria-hidden="true" /> {t('share.readOnly')}
        </span>
        {/* The report button belongs here, not only on the gallery card: someone browsing sees a name,
            someone who has opened the tank sees what is actually in it, and that is the moment they
            know whether it needs reporting. Signed-in only, because a report has to belong to
            somebody (schema.sql: content_reports). */}
        {typeof tank === 'object' && tank && session && (
          <button
            type="button"
            className="gallery-report"
            disabled={reported}
            title={t('gallery.report')}
            onClick={() => {
              setReason('');
              setReporting(true);
            }}
          >
            <i className="fa-solid fa-flag" aria-hidden="true" /> {reported ? t('gallery.reported') : t('gallery.report')}
          </button>
        )}
      </div>

      {reporting && typeof tank === 'object' && tank && (
        <div className="gallery-report-form">
          <p>{t('gallery.reportBody', { name: tank.name })}</p>
          <Input
            value={reason}
            placeholder={t('gallery.reportPlaceholder')}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submitReport(tank.id)}
          />
          <div className="gallery-report-actions">
            <Button type="button" size="sm" variant="secondary" onClick={() => setReporting(false)}>
              {t('gallery.cancel')}
            </Button>
            <Button type="button" size="sm" onClick={() => void submitReport(tank.id)}>
              {t('gallery.reportSend')}
            </Button>
          </div>
        </div>
      )}

      {tank === 'loading' && <p className="tab-panel-loading">{t('share.loading')}</p>}
      {tank === 'error' && <p className="tab-panel-loading">{t('share.loadFailed')}</p>}
      {tank === null && <p className="tab-panel-loading">{t('share.notAvailable')}</p>}
      {/* Keyed by tank id: the engine reads its source once, when it is constructed (see useTank), so
          opening a different shared tank has to be a different engine rather than the same one asked
          to change its mind mid-simulation. */}
      {typeof tank === 'object' && tank && <SharedTankStage key={tank.id} tank={tank} />}
    </div>
  );
}

function SharedTankStage({ tank }: { tank: SharedTank }) {
  const source = useMemo<TankSource>(
    () => ({ load: async () => ({ tankId: tank.id, sprites: tank.sprites, state: tank.state }) }),
    [tank],
  );
  const engine = useTank({ source, readOnly: true });
  const { t } = useLanguage();

  if (!engine.ready) return <p className="tab-panel-loading">{t('share.loading')}</p>;
  return <SharedTankCanvas engine={engine} />;
}
