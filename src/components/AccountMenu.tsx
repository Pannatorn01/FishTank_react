import { useEffect, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { sendMagicLink, signOut, useAuth } from '@/hooks/useAuth';
import { getSync } from '@/lib/data';
import { useLanguage } from '@/lib/i18n';

type Phase = 'closed' | 'email' | 'sent' | 'claim' | 'claiming' | 'claimed';

/**
 * Signing in, and the one moment that decides whether a user keeps their work: the first time they
 * sign in on a browser that already holds a tank.
 *
 * The app is usable, permanently, without an account (see docs/STORAGE_DB_MIGRATION_PLAN.md §0), so
 * this is an offer, never a gate - no modal on load, no wall in front of the editor. When there is no
 * Supabase project configured it disappears entirely rather than offering something that cannot work.
 */
export function AccountMenu() {
  const { t } = useLanguage();
  const { session, email, ready, available } = useAuth();
  const [phase, setPhase] = useState<Phase>('closed');
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState(0);

  // Signing in on a browser that already has work is the moment that work can be lost - by being left
  // behind on a device the user then stops using. Ask once, as soon as it happens, rather than hoping
  // they find a settings screen later.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    void (async () => {
      const sync = getSync();
      if (!sync) return;
      const claimedBy = await sync.claimedBy();
      if (!cancelled && claimedBy !== session.user.id) setPhase('claim');
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  if (!available || !ready) return null;

  const submitEmail = async () => {
    setError(null);
    const result = await sendMagicLink(input.trim());
    if (result.ok) setPhase('sent');
    else setError(result.error ?? 'error');
  };

  const claim = async () => {
    const sync = getSync();
    if (!sync || !session) return;
    setPhase('claiming');
    const result = await sync.claimLocalWork(session.user.id);
    setUploaded(result.uploaded);
    // Not "done" unless the queue actually drained - see claimLocalWork. If anything is still waiting
    // the user is told it will finish by itself, which is true: the outbox retries.
    setPhase(result.ok ? 'claimed' : 'closed');
  };

  return (
    <>
      {session ? (
        <Button type="button" size="sm" variant="secondary" title={email ?? undefined} onClick={() => void signOut()}>
          <i className="fa-solid fa-right-from-bracket" /> {t('auth.signOut')}
        </Button>
      ) : (
        <Button type="button" size="sm" variant="secondary" onClick={() => setPhase('email')}>
          <i className="fa-solid fa-cloud-arrow-up" /> {t('auth.signIn')}
        </Button>
      )}

      <AlertDialog open={phase === 'email'} onOpenChange={(open) => !open && setPhase('closed')}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('auth.signInTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('auth.signInBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            type="email"
            value={input}
            placeholder={t('auth.emailPlaceholder')}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submitEmail()}
          />
          {error && <p className="account-error">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>{t('auth.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void submitEmail();
              }}
            >
              {t('auth.sendLink')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={phase === 'sent'} onOpenChange={(open) => !open && setPhase('closed')}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('auth.sentTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('auth.sentBody', { email: input })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>{t('auth.ok')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={phase === 'claim' || phase === 'claiming'} onOpenChange={(open) => !open && setPhase('closed')}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('auth.claimTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('auth.claimBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {/* Declining is safe and reversible: nothing is deleted, and the offer returns next sign-in. */}
            <AlertDialogCancel disabled={phase === 'claiming'}>{t('auth.claimLater')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={phase === 'claiming'}
              onClick={(e) => {
                e.preventDefault();
                void claim();
              }}
            >
              {phase === 'claiming' ? t('auth.claiming') : t('auth.claimNow')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={phase === 'claimed'} onOpenChange={(open) => !open && setPhase('closed')}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('auth.claimedTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('auth.claimedBody', { count: uploaded })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>{t('auth.ok')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
