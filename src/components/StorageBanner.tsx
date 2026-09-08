import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/lib/i18n';
import { downloadDataBackup, estimateUsage } from '@/lib/storage';

/** Below this the banner stays hidden - a warning that is always on screen stops being a warning, and
 *  the app is perfectly healthy at half-full. Chosen so there is still room for a couple of large
 *  sprites between the first warning and an actual failed save. */
const WARN_AT_PERCENT = 70;

/**
 * Tells the user the browser store is filling up (or that nothing can be saved at all this session)
 * while they can still do something about it - exporting a backup and deleting old work. Without it the
 * first sign of a full store is a save that fails, which is the one moment the user cannot afford it.
 * See docs/STORAGE_DB_MIGRATION_PLAN.md P0-2/P0-5.
 */
export function StorageBanner({ readOnly }: { readOnly: boolean }) {
  const { t } = useLanguage();
  const [percent, setPercent] = useState(() => estimateUsage().percent);

  useEffect(() => {
    // Re-measure when the library actually changes rather than on a timer: sprites are the only thing
    // big enough to move the number, and both events already fire on every save/delete.
    const remeasure = () => setPercent(estimateUsage().percent);
    window.addEventListener('ft:sprites-updated', remeasure);
    window.addEventListener('ft:sprite-deleted', remeasure);
    return () => {
      window.removeEventListener('ft:sprites-updated', remeasure);
      window.removeEventListener('ft:sprite-deleted', remeasure);
    };
  }, []);

  if (!readOnly && percent < WARN_AT_PERCENT) return null;

  return (
    <div className={`storage-banner${readOnly ? ' storage-banner-error' : ''}`} role="status">
      <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
      <span>{readOnly ? t('error.readOnly') : t('storage.nearlyFull', { percent: Math.round(percent) })}</span>
      <Button type="button" size="sm" variant="secondary" onClick={() => downloadDataBackup()}>
        <i className="fa-solid fa-download" /> {t('storage.exportBackup')}
      </Button>
    </div>
  );
}
