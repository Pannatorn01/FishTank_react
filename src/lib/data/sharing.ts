import { getSupabase } from '../supabase';
import type { Instance, RoomInstance, Sprite, TankGroup } from '../types';
import type { TankState } from './adapter';
import { rowToChild, rowToSprite, type ChildRow, type SpriteRow, type TankSettings } from './rows';

/**
 * Everything the app does about *other people's* tanks, and about letting other people see its own
 * (plan §4 P6.3).
 *
 * Kept apart from the sync engine on purpose, and this is the whole design decision: a tank someone
 * shared with you never enters the local database, the outbox, or the merge. It is fetched when you
 * open it, held in memory while you look at it, and gone when you close the tab. The plan asked for a
 * separate `remoteTanks` store that could be wiped; not writing it down at all is the same guarantee
 * with nothing left to wipe - and it makes "did someone else's fish end up in my library?" a question
 * with a structural answer rather than a hopeful one.
 *
 * Everything below is a single round trip to Supabase and returns plain data. Nothing here writes.
 */

export type TankVisibility = 'private' | 'unlisted' | 'public';

export interface ShareState {
  visibility: TankVisibility;
  /** The secret half of an unlisted link. Null until the tank has been unlisted at least once. */
  shareSlug: string | null;
}

export interface ShareEntry {
  email: string;
  /** True while this address has no account yet - the invitation is waiting (schema.sql:
   *  tank_invites). It becomes a real share the first time they sign in. */
  pending: boolean;
}

export interface SharedTankSummary {
  id: string;
  name: string;
  updatedAt: number;
}

/** A tank belonging to someone else, as far as this browser is ever allowed to know it. */
export interface SharedTank {
  id: string;
  name: string;
  state: TankState;
  /** Only the sprites this tank actually uses - the rest of the owner's library is not part of what
   *  they shared, and the database will not return it (schema.sql: get_shared_tank). */
  sprites: Sprite[];
}

function client() {
  const supabase = getSupabase();
  if (!supabase) throw new Error('sharing needs a Supabase project');
  return supabase;
}

/**
 * 128 bits from the platform's cryptographic generator, hex-encoded.
 *
 * Deliberately not `uid()` (src/lib/storage.ts): that is Math.random plus a timestamp, which is a fine
 * identifier and a poor secret, and this string is the only thing standing between an unlisted tank and
 * anyone who cares to guess. See schema.sql's P6-3 note.
 */
function mintSlug(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The link to hand out for an unlisted tank. Built from wherever the app is actually running, so it
 *  works the same in dev, on a preview deploy and in production. */
export function shareLink(tankId: string, slug: string): string {
  const url = new URL(window.location.href);
  url.hash = '';
  url.search = `?tank=${encodeURIComponent(tankId)}&k=${encodeURIComponent(slug)}`;
  return url.toString();
}

/** What the tank id and slug in the current URL are, if the page was opened from a share link. */
export function shareTargetFromUrl(): { tankId: string; slug: string | null } | null {
  const params = new URLSearchParams(window.location.search);
  const tankId = params.get('tank');
  return tankId ? { tankId, slug: params.get('k') } : null;
}

/**
 * How this tank is currently shared. Null when the server has never seen it - a tank that has only
 * ever existed in this browser cannot be shared with anyone yet, and saying so is more useful than
 * inventing a default that would be wrong the moment it synced.
 */
export async function loadShareState(tankId: string): Promise<ShareState | null> {
  const { data, error } = await client().from('tanks').select('visibility, share_slug').eq('id', tankId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { visibility: (data.visibility as TankVisibility) ?? 'private', shareSlug: data.share_slug ?? null };
}

/**
 * Changes who can reach this tank.
 *
 * Turning on an unlisted link mints the slug if there is not one already, and turning it off again
 * deliberately keeps the slug rather than rotating it: re-sharing after a change of mind should give
 * the same people back the link they already have. Rotating on purpose is what `rotateShareSlug` is
 * for, and it is a different button precisely because it breaks every link handed out so far.
 */
export async function setTankVisibility(tankId: string, visibility: TankVisibility): Promise<ShareState> {
  const current = await loadShareState(tankId);
  if (!current) throw new Error('this tank has not been backed up yet');
  const slug = current.shareSlug ?? (visibility === 'unlisted' ? mintSlug() : null);
  const { error } = await client()
    .from('tanks')
    .update({ visibility, ...(slug && slug !== current.shareSlug ? { share_slug: slug } : {}) })
    .eq('id', tankId);
  if (error) throw error;
  return { visibility, shareSlug: slug };
}

/** Invalidates every link already handed out, by replacing the secret they contain. */
export async function rotateShareSlug(tankId: string): Promise<string> {
  const slug = mintSlug();
  const { error } = await client().from('tanks').update({ share_slug: slug }).eq('id', tankId);
  if (error) throw error;
  return slug;
}

export async function listShares(tankId: string): Promise<ShareEntry[]> {
  const { data, error } = await client().rpc('tank_share_list', { t_id: tankId });
  if (error) throw error;
  return ((data ?? []) as Array<{ email: string; pending: boolean }>).map((r) => ({ email: r.email, pending: r.pending }));
}

/**
 * Shares with an email address.
 *
 * It resolves whether or not that address has an account, and says nothing about which - see the
 * function's own comment in schema.sql. The UI has to phrase its confirmation to match: "they will see
 * it once they sign in" is true either way, where "invitation sent" would not be.
 */
export async function shareTankWith(tankId: string, email: string): Promise<void> {
  const { error } = await client().rpc('share_tank', { t_id: tankId, viewer_email: email });
  if (error) throw error;
}

export async function unshareTankWith(tankId: string, email: string): Promise<void> {
  const { error } = await client().rpc('unshare_tank', { t_id: tankId, viewer_email: email });
  if (error) throw error;
}

/** Picks up any invitations addressed to this account's email. Called once after sign-in; harmless to
 *  call again, and it returns how many were waiting so the UI can mention them. */
export async function claimTankInvites(): Promise<number> {
  const supabase = getSupabase();
  if (!supabase) return 0;
  const { data, error } = await supabase.rpc('claim_tank_invites');
  if (error) {
    console.warn('claiming tank invites failed', error);
    return 0;
  }
  return typeof data === 'number' ? data : 0;
}

export async function tanksSharedWithMe(): Promise<SharedTankSummary[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('tanks_shared_with_me');
  if (error) throw error;
  return ((data ?? []) as Array<{ id: string; name: string; updated_at: number }>).map((r) => ({
    id: r.id,
    name: r.name,
    updatedAt: r.updated_at,
  }));
}

interface SharedTankBundle {
  tank: { id: string; name: string; settings: Partial<TankSettings> };
  instances: ChildRow[];
  groups: ChildRow[];
  room: ChildRow[];
  sprites: SpriteRow[];
}

/**
 * Fetches a tank someone else shared, or null when it is not shared with this viewer (a wrong slug, a
 * share that was withdrawn, a tank that was deleted - all the same answer on purpose, since telling
 * them apart would tell a stranger which tank ids exist).
 *
 * The whole tank arrives in one call, authorised once, on the server (schema.sql: get_shared_tank).
 */
export async function fetchSharedTank(tankId: string, slug: string | null): Promise<SharedTank | null> {
  const { data, error } = await client().rpc('get_shared_tank', { t_id: tankId, slug });
  if (error) throw error;
  if (!data) return null;
  const bundle = data as SharedTankBundle;

  const settings = bundle.tank.settings ?? {};
  const state: TankState = {
    ...emptySharedTankState(),
    ...settings,
    instances: bundle.instances.map((row) => rowToChild<Instance>(row)),
    groups: bundle.groups.map((row) => rowToChild<TankGroup>(row)),
    roomInstances: bundle.room.map((row) => rowToChild<RoomInstance>(row)),
  };

  return {
    id: bundle.tank.id,
    name: bundle.tank.name,
    state,
    sprites: bundle.sprites.map((row) => rowToSprite(row)),
  };
}

/** The tank's own fields as they stand before the owner's settings are laid over them. Identical in
 *  spirit to the adapters' empty state; kept here rather than exported from one of them because a
 *  remote tank is never written anywhere and has no business reaching into local storage's code. */
function emptySharedTankState(): TankState {
  return {
    instances: [],
    groups: [],
    roomInstances: [],
    width: null,
    height: null,
    shape: 'rectangle',
    cornerRadiusFrac: 0.22,
    ovalTopCutFrac: 0.28,
    backgroundSpriteId: null,
    roomBackgroundSpriteId: null,
    backgroundTransform: { x: 0, y: 0, scale: 1, rotation: 0 },
    waterLevel: 1,
    algae: 0,
    // A tank being looked at is not a tank being simulated forward: leaving this null is what stops
    // the engine replaying however many days of hunger and evaporation happened since its owner last
    // saved, onto a copy the viewer cannot feed or refill.
    lastTickAt: null,
  };
}
