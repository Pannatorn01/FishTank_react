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
  type TankVisibility,
} from '@/lib/data/sharing';
import { useLanguage } from '@/lib/i18n';
import { TankGalleryDialog } from './TankGalleryDialog';

/**
 * Who can see this tank, which tanks other people have shared back, and the way into the public
 * listing.
 *
 * `public` was missing from this panel until there was somewhere for a public tank to appear: the
 * policies have allowed it since P6-3, but offering it with nothing listing tanks would have been an
 * unlisted tank with a guessable address, which is worse than the unlisted option next to it. The
 * listing (P6-6) is what makes the third choice mean something, and the reporting it needs came with
 * the sprite gallery (P6-5) and already covered tanks.
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
  const [browsing, setBrowsing] = useState(false);

  const reload = useCallback(async () => {
    if (!tankId || !session) return;
    try {
      const state = await loadShareState(tankId);
      // Cleared here rather than before the request: a previous error stays on screen until fresh data
      // actually arrives, instead of blanking and then reappearing if the reload fails too.
      setError(null);
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
    // Same as useGallery: the reads happen over the network and every setState in reload() is after
    // an await. Nothing here runs synchronously during the effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  if (!available) return <p className="tank-share-hint">{t('share.needsProject')}</p>;

  // Signing in is needed to share a tank, not to look at what other people have published - the
  // listing is granted to anonymous callers on purpose (schema.sql: gallery_tanks), so a guest gets
  // the gallery rather than a dead end telling them to come back with an account.
  if (!session) {
    return (
      <div className="tank-share-panel">
        <p className="tank-share-hint">{t('share.needsAccount')}</p>
        <div className="tank-share-section">
          <h3 className="tank-share-heading">{t('tankGallery.heading')}</h3>
          <p className="tank-share-hint">{t('tankGallery.hint')}</p>
          <Button type="button" size="sm" variant="secondary" onClick={() => setBrowsing(true)}>
            <i className="fa-solid fa-globe" /> {t('tankGallery.browse')}
          </Button>
        </div>
        <TankGalleryDialog open={browsing} onClose={() => setBrowsing(false)} onError={setError} />
        {error && <p className="account-error">{error}</p>}
      </div>
    );
  }

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

  const setVisibility = (visibility: TankVisibility) =>
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
      if (!tankId || share === 'absent') return;
      // Keeps whatever the tank's visibility actually is. Rotating replaces the secret in the link, it
      // does not change who the tank is offered to - and a public tank told it had become unlisted
      // would be a lie the panel then acted on.
      setShare({ visibility: share.visibility, shareSlug: await rotateShareSlug(tankId) });
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
              <Button
                type="button"
                size="sm"
                variant={share.visibility === 'public' ? 'default' : 'secondary'}
                disabled={busy}
                onClick={() => setVisibility('public')}
              >
                <i className="fa-solid fa-globe" /> {t('share.public')}
              </Button>
            </div>
            <p className="tank-share-hint">
              {share.visibility === 'public'
                ? t('share.publicBody')
                : share.visibility === 'unlisted'
                  ? t('share.unlistedBody')
                  : t('share.privateBody')}
            </p>
            {/* A public tank keeps its link working too - it is strictly more open than unlisted, and
                taking the link away from the people already holding one would be a surprise. */}
            {(share.visibility === 'unlisted' || share.visibility === 'public') && link && (
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

      <div className="tank-share-section">
        <h3 className="tank-share-heading">{t('tankGallery.heading')}</h3>
        <p className="tank-share-hint">{t('tankGallery.hint')}</p>
        <Button type="button" size="sm" variant="secondary" onClick={() => setBrowsing(true)}>
          <i className="fa-solid fa-globe" /> {t('tankGallery.browse')}
        </Button>
      </div>

      {error && <p className="account-error">{error}</p>}
      <TankGalleryDialog open={browsing} onClose={() => setBrowsing(false)} onError={setError} />
    </div>
  );
}
