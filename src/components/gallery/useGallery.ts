import { useCallback, useEffect, useState } from 'react';
import { reportContent, type ReportTarget } from '@/lib/data/gallery';

/** Every gallery listing is cursor-paged the same way (see `listGallery`/`listTankGallery`). */
export interface Paged {
  cursor: string;
}

export const GALLERY_PAGE = 60;

/**
 * One page of a gallery listing, plus "load more" - the sprite gallery and the tank gallery differ only
 * in which listing function they call, so this holds the part that is the same: reset-and-reload when
 * the dialog opens, append rather than replace when paging, decide whether a "load more" button is
 * warranted (a short page means there is no next one), and turn a thrown request into an error message
 * plus an empty list rather than a dialog stuck on "loading" forever.
 *
 * `items === null` means "still loading", `[]` means "loaded, and there is nothing here" - a
 * distinction both dialogs show different text for, which is why this is not one `items: T[]`.
 */
export function useGalleryPage<T extends Paged>(
  open: boolean,
  listPage: (limit: number, before?: string) => Promise<T[]>,
  onError: (msg: string) => void
) {
  const [items, setItems] = useState<T[] | null>(null);
  const [more, setMore] = useState(false);

  const load = useCallback(
    async (before?: string) => {
      try {
        const page = await listPage(GALLERY_PAGE, before);
        setItems((prev) => (before && prev ? [...prev, ...page] : page));
        setMore(page.length === GALLERY_PAGE);
      } catch (e) {
        onError(e instanceof Error ? e.message : String(e));
        setItems([]);
      }
    },
    [listPage, onError]
  );

  useEffect(() => {
    if (!open) return;
    setItems(null);
    void load();
  }, [open, load]);

  /** Fetches the page after the last item currently shown. */
  const loadMore = useCallback(() => {
    void load(items?.[items.length - 1]?.cursor);
  }, [load, items]);

  return { items, more, loadMore };
}

/**
 * The "report this" flow, shared by both galleries: which entry is being reported (`null` = the form is
 * closed), the reason being typed, and which entries have already been reported this session.
 *
 * The form closes the moment it is submitted, before the request resolves, and the entry is marked
 * reported whether or not anything came back. That is deliberate and matches `reportContent`: a
 * reporter is told their report was received and nothing more - not whether anyone else had already
 * reported it, nor what happened next.
 */
export function useContentReport<T>(target: ReportTarget, idOf: (entry: T) => string, onError: (msg: string) => void) {
  const [reporting, setReporting] = useState<T | null>(null);
  const [reason, setReason] = useState('');
  const [reported, setReported] = useState<Set<string>>(new Set());

  const begin = useCallback((entry: T) => {
    setReason('');
    setReporting(entry);
  }, []);

  const cancel = useCallback(() => setReporting(null), []);

  const submit = useCallback(async () => {
    if (!reporting) return;
    const entry = reporting;
    setReporting(null);
    try {
      await reportContent(target, idOf(entry), reason.trim());
      setReported((prev) => new Set(prev).add(idOf(entry)));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setReason('');
    }
  }, [reporting, target, idOf, reason, onError]);

  return {
    reporting,
    reason,
    setReason,
    hasReported: (entry: T) => reported.has(idOf(entry)),
    begin,
    cancel,
    submit,
  };
}
