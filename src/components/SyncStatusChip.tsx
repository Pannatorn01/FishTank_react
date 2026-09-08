import { useEffect, useState } from 'react';
import { getSync, type SyncStatus } from '@/lib/data';
import { useLanguage } from '@/lib/i18n';

/**
 * A one-line answer to "is my work safe anywhere but this browser?".
 *
 * It renders nothing at all when the app is local-only (no Supabase project configured), because in
 * that mode there is no sync to have an opinion about, and a permanently grey "not syncing" chip would
 * only be noise. Signed in and idle is the quiet case; anything else - queued changes, offline, an
 * error - is worth a word, because those are the states where closing the laptop loses something.
 */
export function SyncStatusChip() {
  const { t } = useLanguage();
  const [status, setStatus] = useState<SyncStatus | null>(null);

  useEffect(() => {
    const sync = getSync();
    if (!sync) return;
    return sync.subscribe(setStatus);
  }, []);

  if (!status) return null;
  if (status.state === 'signed-out' && status.pending === 0) return null;

  const label =
    status.state === 'offline'
      ? t('sync.offline')
      : status.state === 'error'
        ? t('sync.error')
        : status.state === 'syncing'
          ? t('sync.syncing')
          : status.pending > 0
            ? t('sync.pending', { count: status.pending })
            : t('sync.synced');

  const icon =
    status.state === 'offline'
      ? 'fa-cloud-slash'
      : status.state === 'error'
        ? 'fa-triangle-exclamation'
        : status.state === 'syncing'
          ? 'fa-arrows-rotate'
          : status.pending > 0
            ? 'fa-cloud-arrow-up'
            : 'fa-cloud-check';

  return (
    <span className={`sync-chip sync-chip-${status.state}`} title={status.lastError ?? undefined}>
      <i className={`fa-solid ${icon}`} aria-hidden="true" /> {label}
    </span>
  );
}
