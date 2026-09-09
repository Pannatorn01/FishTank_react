import { getRepos } from './index';
import { newRecordMeta, uid } from '../storage';
import { getSupabase } from '../supabase';
import type { Sprite } from '../types';
import { rowToSprite, type SpriteRow } from './rows';

/**
 * The public sprite gallery, and the report button that has to exist alongside it (plan P6.4/P6.5).
 *
 * Two rules shape everything here:
 *
 * - **Copying, not linking.** Adding a gallery sprite to your library makes a new sprite with a new id
 *   that happens to have the same pixels. The original can then be edited, unpublished or deleted and
 *   your copy is untouched - and, just as importantly, the copy is *yours*, so it syncs, publishes and
 *   deletes like anything else you drew. `forkedFrom` records where it came from and is the only thing
 *   that survives of the relationship.
 *
 * - **Nothing here writes to another person's data.** Publishing changes your own sprite's visibility;
 *   reporting inserts a row that only an administrator can read. Row-level security enforces both, so
 *   the worst a broken client can do is fail.
 */

export interface GallerySprite {
  sprite: Sprite;
  /** Server-side ordering key, passed back as `before` to fetch the next page. */
  cursor: string;
}

function client() {
  const supabase = getSupabase();
  if (!supabase) throw new Error('the gallery needs a Supabase project');
  return supabase;
}

/** One page of published sprites, newest first. Browsing works signed out. */
export async function listGallery(limit = 60, before?: string): Promise<GallerySprite[]> {
  const { data, error } = await client().rpc('gallery_sprites', { lim: limit, before: before ?? null });
  if (error) throw error;
  return ((data ?? []) as Array<SpriteRow & { server_updated_at: string }>).map((row) => ({
    // The gallery deliberately returns no timestamps of the author's own, so the copy this produces is
    // stamped as new when it is forked, not backdated to whenever the original was drawn.
    sprite: rowToSprite({ ...row, updated_at: 0, deleted_at: 0 }),
    cursor: row.server_updated_at,
  }));
}

/**
 * Publishes or unpublishes one of your own sprites.
 *
 * Written to the server first, then locally: if the request fails, nothing has claimed to be public
 * that is not. The local copy is what the library badge reads, and the sync engine carries the same
 * value to your other devices.
 */
export async function setSpriteVisibility(sprite: Sprite, visibility: 'private' | 'public'): Promise<Sprite> {
  const { error } = await client()
    .from('sprites')
    .update({ visibility, updated_at: Date.now() })
    .eq('id', sprite.id);
  if (error) throw error;

  const updated: Sprite = { ...sprite, visibility, updatedAt: Date.now() };
  await getRepos().sprites.put(updated);
  return updated;
}

/**
 * Copies a gallery sprite into this user's library.
 *
 * Everything identifying about the original is dropped except `forkedFrom`: a new id, a fresh
 * timestamp, private, and never marked as a fork of a fork - `forked_from` points at the sprite this
 * was actually copied from, and the gallery row already carries its own origin if it was itself a copy.
 */
export async function forkGallerySprite(entry: GallerySprite): Promise<Sprite> {
  const copy: Sprite = {
    ...entry.sprite,
    ...newRecordMeta(),
    id: uid('sprite'),
    visibility: 'private',
    forkedFrom: entry.sprite.id,
  };
  await getRepos().sprites.put(copy);
  window.dispatchEvent(new CustomEvent('ft:sprites-updated'));
  return copy;
}

export type ReportTarget = 'sprite' | 'tank';

/**
 * Reports a gallery sprite or a shared tank.
 *
 * The reporter never learns what their report did - not whether the item was already reported, nor how
 * close it is to being hidden. Both are deliberate: a count is what someone organising a pile-on would
 * want to watch (see autohide_reported in schema.sql). Reporting the same item twice is not an error
 * either, it just does not do anything the first one did not.
 */
export async function reportContent(target: ReportTarget, targetId: string, reason: string): Promise<void> {
  const { error } = await client()
    .from('content_reports')
    .upsert({ target_type: target, target_id: targetId, reason: reason.slice(0, 500) }, { onConflict: 'target_type,target_id,reporter_id' });
  if (error) throw error;
}
