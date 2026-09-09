import { useCallback, useEffect, useRef, useState } from 'react';
import { reportContent, type ReportTarget } from '@/lib/data/gallery';

/** Every gallery listing is cursor-paged the same way (see `listGallery`/`listTankGallery`). */
export interface Paged {
  cursor: string;
}

export const GALLERY_PAGE = 60;

/**
 * One page of a gallery listing, plus "load more" - the sprite gallery and the tank gallery differ only
 * in which listing function they call, so this holds the part that is the same: load on mount, append
 * rather than replace when paging, decide whether a "load more" button is warranted (a short page means
 * there is no next one), and turn a thrown request into an error message plus an empty list rather than
 * a dialog stuck on "loading" forever.
 *
 * `items === null` means "still loading", `[]` means "loaded, and there is nothing here" - a
 * distinction both dialogs show different text for, which is why this is not one `items: T[]`.
 *
 * There is deliberately no `open` parameter and no reset. Both dialogs mount their body only while they
 * are open, so re-opening one mounts this fresh and `items` starts at null on its own. Taking `open`
 * and clearing the list in an effect instead meant the hook outlived the dialog and then had to undo
 * itself - a render showing the previous visit's results before the reset landed.
 */
export function useGalleryPage<T extends Paged>(
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

  /**
   * The first page is fetched once per mount, and only once.
   *
   * The guard is not decoration. `load` is rebuilt whenever `onError` changes identity, which for a
   * caller passing an inline arrow is every render - and StrictMode's develop-mode mount/unmount/mount
   * double-invoke fires the effect a second time on the same instance, refs and all. Without this the
   * gallery issued two identical listing requests on open, which is exactly what the browser probe
   * caught after the dialog body started mounting fresh each time.
   */
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // Fetching a page IS synchronizing with an external system - the case effects exist for. The
    // setState calls all happen after the await inside load(), which the rule cannot see from here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

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
