import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import type { TankEngine } from '@/hooks/useTank';
import { getSync } from '@/lib/data';
import {
  listShares,
  loadShareState,
  rotateShareSlug,
  setTankVisibility,
  shareLink,
  shareTankWith,
  tanksSharedWithMe,
  unshareTankWith,
  type ShareEntry,
  type ShareState,
  type SharedTankSummary,
} from '@/lib/data/sharing';
import { useLanguage } from '@/lib/i18n';

/**
 * Who can see this tank, and which tanks other people have shared back.
 *
 * `public` is missing on purpose. The column accepts it and the policies honour it, but a listing
 * anyone can browse needs a report button and somewhere for the reports to go, and the plan is explicit
 * that neither ships before the other (§4 P6.4/P6.5). Until then the two honest options are "nobody"
 * and "the people I hand it to".
 */
export function TankSharePanel({ engine }: { engine: TankEngine }) {
  const { t } = useLanguage();
  const { session, available } = useAuth();
  const tankId = engine.tankId;

  // 'loading' before the first answer, 'absent' when the server has never seen this tank at all - two
  // states that are neither an error nor a share setting, and that the panel says different things about.
  const [share, setShare] = useState<ShareState | 'loading' | 'absent'>('loading');
  const [people, setPeople] = useState<ShareEntry[]>([]);
  const [sharedWithMe, setSharedWithMe] = useState<SharedTankSummary[]>([]);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const reload = useCallback(async () => {
    if (!tankId || !session) return;
    setError(null);
    try {
      const state = await loadShareState(tankId);
      // No row on the server yet: this tank has only ever existed in this browser. Nothing is wrong,
      // there is simply nothing to share until it has been uploaded once.
      setShare(state ?? 'absent');
      setPeople(state ? await listShares(tankId) : []);
      setSharedWithMe(await tanksSharedWithMe());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setShare('absent');
    }
  }, [tankId, session]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!available) return <p className="tank-share-hint">{t('share.needsProject')}</p>;
  if (!session) return <p className="tank-share-hint">{t('share.needsAccount')}</p>;
  if (share === 'loading') return <p className="tank-share-hint">{t('share.loading')}</p>;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const syncFirst = () =>
    run(async () => {
      await getSync()?.syncNow();
      await reload();
    });

  const setVisibility = (visibility: 'private' | 'unlisted') =>
    run(async () => {
      if (!tankId) return;
      setShare(await setTankVisibility(tankId, visibility));
    });

  const addPerson = () =>
    run(async () => {
      if (!tankId || !email.trim()) return;
      await shareTankWith(tankId, email.trim());
      setEmail('');
      // Says the same thing whether or not that address has an account - the database deliberately
      // does not tell us which, so that nobody can use this to find out (schema.sql: share_tank).
      setNotice(t('share.added'));
      setPeople(await listShares(tankId));
    });

  const removePerson = (address: string) =>
    run(async () => {
      if (!tankId) return;
      await unshareTankWith(tankId, address);
      setPeople(await listShares(tankId));
    });

  const rotate = () =>
    run(async () => {
      if (!tankId) return;
      setShare({ visibility: 'unlisted', shareSlug: await rotateShareSlug(tankId) });
    });

  const link = share !== 'absent' && share.shareSlug && tankId ? shareLink(tankId, share.shareSlug) : null;

  const copyLink = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="tank-share-panel">
      {share === 'absent' ? (
        <>
          <p className="tank-share-hint">{t('share.notUploaded')}</p>
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={syncFirst}>
            <i className="fa-solid fa-cloud-arrow-up" /> {t('share.uploadNow')}
          </Button>
        </>
      ) : (
        <>
          <div className="tank-share-section">
            <h3 className="tank-share-heading">{t('share.linkHeading')}</h3>
            <div className="tank-share-choices">
              <Button
                type="button"
                size="sm"
                variant={share.visibility === 'private' ? 'default' : 'secondary'}
                disabled={busy}
                onClick={() => setVisibility('private')}
              >
                <i className="fa-solid fa-lock" /> {t('share.private')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={share.visibility === 'unlisted' ? 'default' : 'secondary'}
                disabled={busy}
                onClick={() => setVisibility('unlisted')}
              >
                <i className="fa-solid fa-link" /> {t('share.unlisted')}
              </Button>
            </div>
            <p className="tank-share-hint">
              {share.visibility === 'unlisted' ? t('share.unlistedBody') : t('share.privateBody')}
            </p>
            {share.visibility === 'unlisted' && link && (
              <div className="tank-share-link">
                <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
                <Button type="button" size="sm" variant="secondary" onClick={() => void copyLink()}>
                  <i className={`fa-solid ${copied ? 'fa-check' : 'fa-copy'}`} /> {copied ? t('share.copied') : t('share.copy')}
                </Button>
                <Button type="button" size="sm" variant="secondary" disabled={busy} title={t('share.rotateTitle')} onClick={rotate}>
                  <i className="fa-solid fa-rotate" /> {t('share.rotate')}
                </Button>
              </div>
            )}
          </div>

          <div className="tank-share-section">
            <h3 className="tank-share-heading">{t('share.peopleHeading')}</h3>
            <div className="tank-share-link">
              <Input
                type="email"
                value={email}
                placeholder={t('auth.emailPlaceholder')}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addPerson()}
              />
              <Button type="button" size="sm" variant="secondary" disabled={busy || !email.trim()} onClick={addPerson}>
                <i className="fa-solid fa-user-plus" /> {t('share.add')}
              </Button>
            </div>
            {notice && <p className="tank-share-hint">{notice}</p>}
            {people.length === 0 ? (
              <p className="tank-share-hint">{t('share.nobody')}</p>
            ) : (
              <ul className="tank-share-people">
                {people.map((person) => (
                  <li key={person.email}>
                    <span>{person.email}</span>
                    {person.pending && <span className="tank-share-pending">{t('share.pending')}</span>}
                    <button
                      type="button"
                      className="selection-toolbar-btn"
                      title={t('share.remove')}
                      disabled={busy}
                      onClick={() => removePerson(person.email)}
                    >
                      <i className="fa-solid fa-xmark" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      <div className="tank-share-section">
        <h3 className="tank-share-heading">{t('share.withMeHeading')}</h3>
        {sharedWithMe.length === 0 ? (
          <p className="tank-share-hint">{t('share.withMeEmpty')}</p>
        ) : (
          <ul className="tank-share-people">
            {sharedWithMe.map((other) => (
              <li key={other.id}>
                <span>{other.name}</span>
                {/* A window event rather than a callback threaded up through TankPanel/TankSection to
                    App: opening someone else's tank replaces the whole view, which is App's business,
                    and this app already uses window events for the cross-cutting cases (see
                    'ft:sprites-updated'). */}
                <button
                  type="button"
                  className="selection-toolbar-btn"
                  title={t('share.open')}
                  onClick={() =>
                    window.dispatchEvent(new CustomEvent('ft:open-shared-tank', { detail: { tankId: other.id } }))
                  }
                >
                  <i className="fa-solid fa-eye" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p className="account-error">{error}</p>}
    </div>
  );
}
