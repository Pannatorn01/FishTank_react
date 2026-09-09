import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { forkGallerySprite, listGallery, reportContent, type GallerySprite } from '@/lib/data/gallery';
import { useLanguage } from '@/lib/i18n';
import { paintLayers } from '@/lib/pixelMath';
import type { Sprite } from '@/lib/types';

const THUMB_PX = 64;
const PAGE = 60;

function GalleryThumb({ sprite }: { sprite: Sprite }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const width = sprite.width || 16;
    const height = sprite.height || 16;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const cellPx = THUMB_PX / Math.max(width, height);
    ctx.save();
    ctx.translate((THUMB_PX - width * cellPx) / 2, (THUMB_PX - height * cellPx) / 2);
    paintLayers(ctx, sprite.frames[0], width, height, cellPx);
    ctx.restore();
  }, [sprite]);
  return <canvas ref={ref} width={THUMB_PX} height={THUMB_PX} className="pixelated" />;
}

/**
 * Sprites other people have published, and the two things anyone can do with one: take a copy, or
 * report it.
 *
 * The report button is not an afterthought sitting next to the copy button - it is the reason this
 * screen is allowed to exist at all (plan §4 P6.4/P6.5). Browsing works signed out; copying and
 * reporting need an account, because both write something that has to belong to someone.
 */
export function GalleryDialog({ open, onClose, onError }: { open: boolean; onClose: () => void; onError: (msg: string) => void }) {
  const { t } = useLanguage();
  const { session, available } = useAuth();
  const [items, setItems] = useState<GallerySprite[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [reported, setReported] = useState<Set<string>>(new Set());
  const [reporting, setReporting] = useState<GallerySprite | null>(null);
  const [reason, setReason] = useState('');
  const [more, setMore] = useState(false);

  const load = useCallback(
    async (before?: string) => {
      try {
        const page = await listGallery(PAGE, before);
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

  const fork = async (entry: GallerySprite) => {
    setBusyId(entry.sprite.id);
    try {
      await forkGallerySprite(entry);
      setAdded((prev) => new Set(prev).add(entry.sprite.id));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const submitReport = async () => {
    if (!reporting) return;
    const entry = reporting;
    setReporting(null);
    try {
      await reportContent('sprite', entry.sprite.id, reason.trim());
      // Confirmed to the reporter, and nothing more: not whether anyone else has reported it, nor what
      // happened next. See reportContent.
      setReported((prev) => new Set(prev).add(entry.sprite.id));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setReason('');
    }
  };

  return (
    <div className="gallery-backdrop" role="dialog" aria-modal="true" aria-label={t('gallery.title')}>
      <div className="gallery-panel">
        <header className="gallery-header">
          <h2>
            <i className="fa-solid fa-images" aria-hidden="true" /> {t('gallery.title')}
          </h2>
          <Button type="button" size="sm" variant="secondary" onClick={onClose}>
            {t('gallery.close')}
          </Button>
        </header>

        {!available && <p className="gallery-hint">{t('gallery.needsProject')}</p>}
        {available && items === null && <p className="gallery-hint">{t('gallery.loading')}</p>}
        {available && items?.length === 0 && <p className="gallery-hint">{t('gallery.empty')}</p>}

        {!!items?.length && (
          <div className="gallery-grid">
            {items.map((entry) => (
              <div key={entry.sprite.id} className="gallery-card">
                <GalleryThumb sprite={entry.sprite} />
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
                  <button
                    type="button"
                    className="gallery-report"
                    disabled={!session || reported.has(entry.sprite.id)}
                    title={session ? t('gallery.report') : t('gallery.needsAccount')}
                    onClick={() => {
                      setReason('');
                      setReporting(entry);
                    }}
                  >
                    <i className="fa-solid fa-flag" aria-hidden="true" />{' '}
                    {reported.has(entry.sprite.id) ? t('gallery.reported') : t('gallery.report')}
                  </button>
                </div>
              </div>
            ))}
          </div>
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
            <p>{t('gallery.reportBody', { name: reporting.sprite.name })}</p>
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
