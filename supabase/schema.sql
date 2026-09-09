-- Pixel Fish Tank - Supabase schema and row-level security.
--
-- Run this once in the Supabase SQL editor (or `supabase db push`). It is written to be re-runnable:
-- every statement is guarded, so applying it twice changes nothing.
--
-- The design and the reasoning behind it live in docs/STORAGE_DB_MIGRATION_PLAN.md §5. The short
-- version: ids are minted by the client so every write is idempotent, `updated_at` is client epoch ms
-- so it compares directly with what the browser stores, deletions are tombstones rather than removed
-- rows, and RLS is the only thing standing between one user's tank and another's - there is no API
-- server in front of this.

-- ---------------------------------------------------------------- sprites
create table if not exists public.sprites (
  id              text primary key,
  user_id         uuid   not null references auth.users(id) on delete cascade default auth.uid(),
  name            text   not null,
  type            text   not null,
  width           int    not null,
  height          int    not null,
  frame_ms        int    not null,
  frames          jsonb,
  frames_url      text,
  visibility      text   not null default 'private',
  forked_from     text   references public.sprites(id),
  hidden_by_admin boolean not null default false,
  updated_at      bigint not null,
  deleted_at      bigint not null default 0,
  rev             bigint not null default 0,
  created_at      timestamptz not null default now(),
  constraint sprites_visibility_check check (visibility in ('private', 'public'))
);
create index if not exists sprites_user_updated_idx on public.sprites (user_id, updated_at);
create index if not exists sprites_public_idx on public.sprites (visibility)
  where deleted_at = 0 and not hidden_by_admin;

-- ---------------------------------------------------------------- tanks
create table if not exists public.tanks (
  id              text primary key,
  user_id         uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name            text not null default 'My Tank',
  visibility      text not null default 'private',
  hidden_by_admin boolean not null default false,
  settings        jsonb not null default '{}'::jsonb,
  updated_at      bigint not null,
  deleted_at      bigint not null default 0,
  rev             bigint not null default 0,
  created_at      timestamptz not null default now(),
  constraint tanks_visibility_check check (visibility in ('private', 'unlisted', 'public'))
);
create index if not exists tanks_user_updated_idx on public.tanks (user_id, updated_at);

-- ---------------------------------------------------------------- tank contents
create table if not exists public.tank_instances (
  id         text primary key,
  tank_id    text not null references public.tanks(id) on delete cascade,
  user_id    uuid not null default auth.uid(),
  -- Deliberately not `on delete cascade`: removing a sprite that fish in a tank still use is a
  -- decision for the app to walk the user through, not something the database does silently.
  sprite_id  text references public.sprites(id),
  data       jsonb  not null,
  updated_at bigint not null,
  deleted_at bigint not null default 0,
  rev        bigint not null default 0
);
create index if not exists tank_instances_tank_updated_idx on public.tank_instances (tank_id, updated_at);

create table if not exists public.tank_groups (
  id         text primary key,
  tank_id    text not null references public.tanks(id) on delete cascade,
  user_id    uuid not null default auth.uid(),
  data       jsonb  not null,
  updated_at bigint not null,
  deleted_at bigint not null default 0,
  rev        bigint not null default 0
);
create index if not exists tank_groups_tank_updated_idx on public.tank_groups (tank_id, updated_at);

create table if not exists public.room_instances (
  id         text primary key,
  tank_id    text not null references public.tanks(id) on delete cascade,
  user_id    uuid not null default auth.uid(),
  data       jsonb  not null,
  updated_at bigint not null,
  deleted_at bigint not null default 0,
  rev        bigint not null default 0
);
create index if not exists room_instances_tank_updated_idx on public.room_instances (tank_id, updated_at);

-- ---------------------------------------------------------------- sharing and preferences
create table if not exists public.tank_shares (
  tank_id    text not null references public.tanks(id) on delete cascade,
  viewer_id  uuid not null references auth.users(id) on delete cascade,
  -- 'viewer' only for now. Collaborative editing needs better conflict resolution than
  -- last-write-wins, and that is a separate piece of work (plan §4 P6.3).
  role       text not null default 'viewer',
  created_at timestamptz not null default now(),
  primary key (tank_id, viewer_id),
  constraint tank_shares_role_check check (role in ('viewer'))
);

create table if not exists public.user_prefs (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb  not null,
  updated_at bigint not null
);

-- ---------------------------------------------------------------- row-level security
--
-- Two rules learned the hard way here, both from running this file against a real database:
--
-- 1. Qualify every reference to the policy's own row (public.sprites.id, not id). Inside a subquery
--    that joins another table with a column of the same name, a bare name is ambiguous (42702).
--
-- 2. A policy that queries another table runs *that* table's policies too. So a policy on `tanks` that
--    reads `tank_shares`, while `tank_shares`'s own policy reads `tanks`, is infinite recursion
--    (42P17) - which is exactly what happened. The fix is the helper functions below: they are
--    SECURITY DEFINER, so they run as the table owner and are not subject to RLS, which breaks the
--    cycle. They are the only place allowed to look across tables; every policy is then a single call.

-- Is the current user the owner of this tank? Reads `tanks` without invoking its policies.
create or replace function public.owns_tank(t_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tanks t where t.id = t_id and t.user_id = auth.uid());
$$;

-- Has this tank been shared with the current user? Reads `tank_shares` without invoking its policies.
create or replace function public.tank_shared_with_me(t_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tank_shares s where s.tank_id = t_id and s.viewer_id = auth.uid());
$$;

-- May the current user look at this tank at all - as its owner, because it is public/unlisted, or
-- because it was shared with them? This is the single question every "contents of a tank" policy asks.
create or replace function public.can_view_tank(t_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tanks t
    where t.id = t_id
      and t.deleted_at = 0
      and not t.hidden_by_admin
      and (
        t.user_id = auth.uid()
        or t.visibility in ('public', 'unlisted')
        or exists (select 1 from public.tank_shares s where s.tank_id = t.id and s.viewer_id = auth.uid())
      )
  );
$$;

-- Is this sprite used by a tank the current user may look at? Keeps a shared tank from rendering empty
-- without exposing the rest of its owner's library.
create or replace function public.sprite_in_visible_tank(s_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.tank_instances i
    join public.tanks t on t.id = i.tank_id
    where i.sprite_id = s_id
      and t.deleted_at = 0
      and not t.hidden_by_admin
      and (
        t.visibility in ('public', 'unlisted')
        or exists (select 1 from public.tank_shares s where s.tank_id = t.id and s.viewer_id = auth.uid())
      )
  );
$$;

grant execute on function public.owns_tank(text) to anon, authenticated;
grant execute on function public.tank_shared_with_me(text) to anon, authenticated;
grant execute on function public.can_view_tank(text) to anon, authenticated;
grant execute on function public.sprite_in_visible_tank(text) to anon, authenticated;

alter table public.sprites        enable row level security;
alter table public.tanks          enable row level security;
alter table public.tank_instances enable row level security;
alter table public.tank_groups    enable row level security;
alter table public.room_instances enable row level security;
alter table public.tank_shares    enable row level security;
alter table public.user_prefs     enable row level security;

-- Owners do anything with their own rows.
drop policy if exists sprites_owner_rw on public.sprites;
create policy sprites_owner_rw on public.sprites
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists tanks_owner_rw on public.tanks;
create policy tanks_owner_rw on public.tanks
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Anything that lives *inside* a tank is checked twice: it must be your row, and it must be your
-- tank. Checking only `user_id = auth.uid()` is not enough and was a real hole - user_id defaults to
-- the caller, so anyone could insert rows carrying their own id but pointing at someone else's
-- tank_id, and those rows would then show up inside that tank for its owner. Found by running the
-- two-account probe against this project.
drop policy if exists tank_instances_owner_rw on public.tank_instances;
create policy tank_instances_owner_rw on public.tank_instances
  for all using (user_id = auth.uid() and public.owns_tank(public.tank_instances.tank_id))
  with check (user_id = auth.uid() and public.owns_tank(public.tank_instances.tank_id));

drop policy if exists tank_groups_owner_rw on public.tank_groups;
create policy tank_groups_owner_rw on public.tank_groups
  for all using (user_id = auth.uid() and public.owns_tank(public.tank_groups.tank_id))
  with check (user_id = auth.uid() and public.owns_tank(public.tank_groups.tank_id));

drop policy if exists room_instances_owner_rw on public.room_instances;
create policy room_instances_owner_rw on public.room_instances
  for all using (user_id = auth.uid() and public.owns_tank(public.room_instances.tank_id))
  with check (user_id = auth.uid() and public.owns_tank(public.room_instances.tank_id));

drop policy if exists user_prefs_owner_rw on public.user_prefs;
create policy user_prefs_owner_rw on public.user_prefs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Only a tank's owner manages who it is shared with; a viewer can see the row naming them.
drop policy if exists tank_shares_owner_rw on public.tank_shares;
create policy tank_shares_owner_rw on public.tank_shares
  for all using (public.owns_tank(public.tank_shares.tank_id))
  with check (public.owns_tank(public.tank_shares.tank_id));

drop policy if exists tank_shares_viewer_read on public.tank_shares;
create policy tank_shares_viewer_read on public.tank_shares
  for select using (viewer_id = auth.uid());

-- A tank that is public, unlisted, or shared with you is readable - never writable.
drop policy if exists tanks_shared_read on public.tanks;
create policy tanks_shared_read on public.tanks
  for select using (
    deleted_at = 0
    and not hidden_by_admin
    and (
      visibility in ('public', 'unlisted')
      or public.tank_shared_with_me(public.tanks.id)
    )
  );

-- What is inside a readable tank has to be readable too, or a shared tank shows up empty.
drop policy if exists tank_instances_shared_read on public.tank_instances;
create policy tank_instances_shared_read on public.tank_instances
  for select using (public.can_view_tank(public.tank_instances.tank_id));

drop policy if exists tank_groups_shared_read on public.tank_groups;
create policy tank_groups_shared_read on public.tank_groups
  for select using (public.can_view_tank(public.tank_groups.tank_id));

drop policy if exists room_instances_shared_read on public.room_instances;
create policy room_instances_shared_read on public.room_instances
  for select using (public.can_view_tank(public.room_instances.tank_id));

-- Sprites are readable when they are public (the gallery) or when a tank you can see uses them.
-- Everything else in the owner's library stays private.
drop policy if exists sprites_shared_read on public.sprites;
create policy sprites_shared_read on public.sprites
  for select using (
    (deleted_at = 0 and not hidden_by_admin and visibility = 'public')
    or public.sprite_in_visible_tank(public.sprites.id)
  );

-- ---------------------------------------------------------------- server-assigned bookkeeping
-- Two things the client is not allowed to decide.
--
-- `rev` breaks ties when two devices' clocks disagree closely enough that updated_at cannot. A client
-- cannot be trusted to know what the previous revision was.
--
-- `server_updated_at` is what delta pulls filter on. `updated_at` (the client's clock) cannot do that
-- job: a record uploaded now can carry an older client timestamp than one uploaded a minute ago - a
-- sample sprite created on first run and uploaded later at sign-in, say - and would then sit forever
-- below the pulling device's high-water mark, never sent back, never learning its revision. That bug
-- cost real data in testing before this column existed.
alter table public.sprites        add column if not exists server_updated_at timestamptz not null default now();
alter table public.tanks          add column if not exists server_updated_at timestamptz not null default now();
alter table public.tank_instances add column if not exists server_updated_at timestamptz not null default now();
alter table public.tank_groups    add column if not exists server_updated_at timestamptz not null default now();
alter table public.room_instances add column if not exists server_updated_at timestamptz not null default now();

create index if not exists sprites_pull_idx        on public.sprites (user_id, server_updated_at);
create index if not exists tanks_pull_idx          on public.tanks (user_id, server_updated_at);
create index if not exists tank_instances_pull_idx on public.tank_instances (tank_id, server_updated_at);
create index if not exists tank_groups_pull_idx    on public.tank_groups (tank_id, server_updated_at);
create index if not exists room_instances_pull_idx on public.room_instances (tank_id, server_updated_at);

create or replace function public.bump_rev() returns trigger as $$
begin
  new.rev := coalesce(old.rev, 0) + 1;
  new.server_updated_at := now();
  return new;
end;
$$ language plpgsql;

do $$
declare t text;
begin
  foreach t in array array['sprites', 'tanks', 'tank_instances', 'tank_groups', 'room_instances'] loop
    execute format('drop trigger if exists %I_bump_rev on public.%I', t, t);
    execute format(
      'create trigger %I_bump_rev before insert or update on public.%I for each row execute function public.bump_rev()',
      t, t
    );
  end loop;
end $$;

-- ================================================================ P6-3: sharing a tank
--
-- Three ways a tank can reach someone else, in increasing order of exposure:
--
--   private   - nobody but the owner. The default, and what every tank stays until asked otherwise.
--   unlisted  - anyone holding the link. The link carries a `share_slug`, NOT the tank id (see below).
--   public    - listed in a gallery. The column accepts it, the app does not offer it yet: a public
--               listing without a report button and a moderation queue is the one thing the plan says
--               not to ship (§4 P6.4/P6.5).
--
-- Why a slug rather than the tank id: ids are minted by the client as `tank_<base36 time>_<6 random
-- base36>` (src/lib/storage.ts uid). That is fine for an identifier and useless as a secret - the time
-- half is guessable and the random half is about 2^31. "Anyone with the link" means the link has to be
-- the hard part, so unlisted tanks carry a separate 128-bit slug and the id alone opens nothing.

alter table public.tanks add column if not exists share_slug text;
create unique index if not exists tanks_share_slug_idx on public.tanks (share_slug) where share_slug is not null;

-- Someone invited by email who has not signed up yet. Kept apart from tank_shares because that table
-- points at auth.users and there is no user to point at yet; claim_tank_invites() moves the row across
-- the first time that address signs in.
create table if not exists public.tank_invites (
  tank_id    text not null references public.tanks(id) on delete cascade,
  email      text not null,
  created_at timestamptz not null default now(),
  primary key (tank_id, email)
);

alter table public.tank_invites enable row level security;

drop policy if exists tank_invites_owner_rw on public.tank_invites;
create policy tank_invites_owner_rw on public.tank_invites
  for all using (public.owns_tank(public.tank_invites.tank_id))
  with check (public.owns_tank(public.tank_invites.tank_id));

-- Room decor points at a sprite exactly as an in-tank instance does, and the column was missing: the
-- client sends `sprite_id` for every child row (rows.ts childToRow), so every room-decor upload was
-- rejected for naming a column that does not exist and sat in the outbox retrying forever. Adding the
-- column also lets the sprite policy below resolve a shared tank's room decor, instead of the tank
-- arriving with its decorations missing.
alter table public.room_instances add column if not exists sprite_id text references public.sprites(id);

-- Extended for the same reason: a shared tank whose background and room decor are invisible is not a
-- shared tank, it is a puzzle. `tanks.settings->>'backgroundSpriteId'` is where the background lives
-- (rows.ts tankToRow folds the tank's own fields into that jsonb).
create or replace function public.sprite_in_visible_tank(s_id text) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1
    from public.tanks t
    where t.deleted_at = 0
      and not t.hidden_by_admin
      and (
        t.visibility = 'public'
        or exists (select 1 from public.tank_shares s where s.tank_id = t.id and s.viewer_id = auth.uid())
      )
      and (
        t.settings->>'backgroundSpriteId' = s_id
        or exists (select 1 from public.tank_instances i where i.tank_id = t.id and i.sprite_id = s_id)
        or exists (select 1 from public.room_instances r where r.tank_id = t.id and r.sprite_id = s_id)
      )
  );
$fn$;

-- `unlisted` is deliberately gone from the direct-read policies. An unlisted tank is reachable only
-- through get_shared_tank() below, which demands the slug; leaving it readable by id would have made
-- the id the secret, which is the thing the slug exists to avoid.
drop policy if exists tanks_shared_read on public.tanks;
create policy tanks_shared_read on public.tanks
  for select using (
    deleted_at = 0
    and not hidden_by_admin
    and (visibility = 'public' or public.tank_shared_with_me(public.tanks.id))
  );

create or replace function public.can_view_tank(t_id text) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.tanks t
    where t.id = t_id
      and t.deleted_at = 0
      and not t.hidden_by_admin
      and (
        t.user_id = auth.uid()
        or t.visibility = 'public'
        or exists (select 1 from public.tank_shares s where s.tank_id = t.id and s.viewer_id = auth.uid())
      )
  );
$fn$;

-- ---------------------------------------------------------------- sharing RPCs
--
-- These exist because two things the sharing UI needs cannot be done from the browser against tables:
-- turning an email address into a user id, and turning a user id back into an address to show the
-- owner who they invited. `auth.users` is not readable by anyone, and should not become readable.

-- Share with an email address, whether or not it belongs to an account yet.
--
-- It deliberately returns nothing about the address. Answering "that person has an account" / "they do
-- not" would turn this into an oracle anyone with a tank could ask about any email, so both paths look
-- identical from outside and the UI says the honest thing: they will see it once they sign in.
create or replace function public.share_tank(t_id text, viewer_email text) returns void
language plpgsql security definer set search_path = public as $fn$
declare
  addr text := lower(trim(viewer_email));
  target uuid;
begin
  if not public.owns_tank(t_id) then
    raise exception 'not your tank' using errcode = '42501';
  end if;
  if addr = '' or addr not like '%_@_%._%' then
    raise exception 'not an email address' using errcode = '22023';
  end if;

  select u.id into target from auth.users u where lower(u.email) = addr limit 1;
  if target is null then
    insert into public.tank_invites (tank_id, email) values (t_id, addr) on conflict do nothing;
  elsif target <> auth.uid() then
    insert into public.tank_shares (tank_id, viewer_id, role) values (t_id, target, 'viewer') on conflict do nothing;
  end if;
end;
$fn$;

create or replace function public.unshare_tank(t_id text, viewer_email text) returns void
language plpgsql security definer set search_path = public as $fn$
declare
  addr text := lower(trim(viewer_email));
begin
  if not public.owns_tank(t_id) then
    raise exception 'not your tank' using errcode = '42501';
  end if;
  delete from public.tank_invites i where i.tank_id = t_id and i.email = addr;
  delete from public.tank_shares s
   where s.tank_id = t_id
     and s.viewer_id in (select u.id from auth.users u where lower(u.email) = addr);
end;
$fn$;

-- Who this tank is shared with, as addresses the owner can recognise. Only the owner may ask, and only
-- about their own tank, so this reveals nothing they did not type in themselves.
create or replace function public.tank_share_list(t_id text)
returns table (email text, pending boolean, created_at timestamptz)
language sql stable security definer set search_path = public as $fn$
  select lower(u.email), false, s.created_at
    from public.tank_shares s join auth.users u on u.id = s.viewer_id
   where s.tank_id = t_id and public.owns_tank(t_id)
  union all
  select i.email, true, i.created_at
    from public.tank_invites i
   where i.tank_id = t_id and public.owns_tank(t_id)
  order by 3;
$fn$;

-- Turns invitations addressed to this user's email into real shares. Called by the app after sign-in;
-- safe to call at any time and safe to call twice.
create or replace function public.claim_tank_invites() returns integer
language plpgsql security definer set search_path = public as $fn$
declare
  addr text;
  moved integer := 0;
begin
  select lower(u.email) into addr from auth.users u where u.id = auth.uid();
  if addr is null then return 0; end if;

  with taken as (
    delete from public.tank_invites i where i.email = addr returning i.tank_id
  ), granted as (
    insert into public.tank_shares (tank_id, viewer_id, role)
    select t.tank_id, auth.uid(), 'viewer' from taken t
    on conflict do nothing
    returning 1
  )
  select count(*) into moved from granted;
  return moved;
end;
$fn$;

-- The whole of a tank someone else can see, in one call.
--
-- One function rather than five table reads because there is exactly one authorisation question here -
-- "may this person look at this tank?" - and asking it once, in one place, is how it stays answerable.
-- The RLS policies above still stand behind the tables themselves; this does not replace them.
--
-- `slug` is what makes an unlisted tank readable. It is compared only against this tank's own slug, so
-- a wrong or absent slug simply falls through to the other three reasons someone might be let in (they
-- own it, it is public, it was shared with them).
create or replace function public.get_shared_tank(t_id text, slug text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  tank public.tanks%rowtype;
  allowed boolean;
begin
  select * into tank from public.tanks t where t.id = t_id;
  if not found or tank.deleted_at <> 0 or tank.hidden_by_admin then
    return null;
  end if;

  -- Every `coalesce` here is load-bearing, and this is the one place in the file where SQL's
  -- three-valued logic can actually hurt.
  --
  -- With no session at all, auth.uid() is NULL, so `tank.user_id = auth.uid()` is NULL rather than
  -- false - and `NULL or false or false or false` is NULL, not false. `if not NULL then` does not run
  -- its branch, so the guard below was skipped and the function fell through and returned the tank.
  -- Every private tank in the project was readable in full by anyone who knew (or guessed) its id and
  -- sent no credentials whatsoever. Found by scripts/share-smoke.cjs, which asks an unauthenticated
  -- caller for a tank it should not get.
  --
  -- The lesson generalises: inside a policy's USING clause or a WHERE, NULL is treated as "deny", but
  -- in a plpgsql `if`, NULL is neither branch. A boolean built by hand has to be made total before it
  -- is trusted.
  allowed :=
    coalesce(tank.user_id = auth.uid(), false)
    or tank.visibility = 'public'
    or (tank.visibility = 'unlisted' and slug is not null and tank.share_slug is not null and tank.share_slug = slug)
    or exists (select 1 from public.tank_shares s where s.tank_id = tank.id and s.viewer_id = auth.uid());
  if not coalesce(allowed, false) then
    return null;
  end if;

  return jsonb_build_object(
    'tank', jsonb_build_object(
      'id', tank.id, 'name', tank.name, 'visibility', tank.visibility,
      'settings', tank.settings, 'updated_at', tank.updated_at
    ),
    'instances', coalesce((select jsonb_agg(to_jsonb(i)) from public.tank_instances i
                            where i.tank_id = tank.id and i.deleted_at = 0), '[]'::jsonb),
    'groups',    coalesce((select jsonb_agg(to_jsonb(g)) from public.tank_groups g
                            where g.tank_id = tank.id and g.deleted_at = 0), '[]'::jsonb),
    'room',      coalesce((select jsonb_agg(to_jsonb(r)) from public.room_instances r
                            where r.tank_id = tank.id and r.deleted_at = 0), '[]'::jsonb),
    -- Every sprite the tank actually uses, and nothing else: the rest of the owner's library is not
    -- part of what was shared.
    'sprites',   coalesce((select jsonb_agg(to_jsonb(sp)) from public.sprites sp
                            where sp.deleted_at = 0
                              and not sp.hidden_by_admin
                              and (
                                sp.id = tank.settings->>'backgroundSpriteId'
                                or exists (select 1 from public.tank_instances i where i.tank_id = tank.id and i.sprite_id = sp.id)
                                or exists (select 1 from public.room_instances r where r.tank_id = tank.id and r.sprite_id = sp.id)
                              )), '[]'::jsonb)
  );
end;
$fn$;

-- The tanks other people have shared with this user.
create or replace function public.tanks_shared_with_me()
returns table (id text, name text, updated_at bigint)
language sql stable security definer set search_path = public as $fn$
  select t.id, t.name, t.updated_at
    from public.tanks t
   where t.deleted_at = 0
     and not t.hidden_by_admin
     and t.user_id <> auth.uid()
     and exists (select 1 from public.tank_shares s where s.tank_id = t.id and s.viewer_id = auth.uid())
   order by t.updated_at desc;
$fn$;

revoke all on function public.share_tank(text, text) from public;
revoke all on function public.unshare_tank(text, text) from public;
revoke all on function public.tank_share_list(text) from public;
revoke all on function public.claim_tank_invites() from public;
revoke all on function public.tanks_shared_with_me() from public;

-- Signed-in users only for everything that names a person. get_shared_tank is the one exception: an
-- unlisted link has to work for someone who is not signed in, which is the whole point of a link.
grant execute on function public.share_tank(text, text) to authenticated;
grant execute on function public.unshare_tank(text, text) to authenticated;
grant execute on function public.tank_share_list(text) to authenticated;
grant execute on function public.claim_tank_invites() to authenticated;
grant execute on function public.tanks_shared_with_me() to authenticated;
grant execute on function public.get_shared_tank(text, text) to anon, authenticated;

-- ================================================================ P6-4/P6-5: gallery and moderation
--
-- These two ship together, deliberately. A listing anyone can browse and a way to report what is in it
-- are the same feature: publishing without reporting hands strangers a megaphone with nobody at the
-- other end, and the plan says neither goes out alone (§4 P6.4/P6.5).
--
-- Scope: sprites only. A tank can still be private or unlisted, never public - not because of
-- moderation any more, but because nothing lists tanks, and "public" without a listing is only an
-- unlisted tank with a guessable address. That is a worse offer than the one it replaces.

-- A report is one person saying one thing about one item, once. The primary key is what enforces
-- "once": without it, a single person could file the same complaint until the auto-hide below fired.
create table if not exists public.content_reports (
  target_type text not null,
  target_id   text not null,
  reporter_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  reason      text not null default '',
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  primary key (target_type, target_id, reporter_id),
  constraint content_reports_target_check check (target_type in ('sprite', 'tank'))
);
create index if not exists content_reports_open_idx on public.content_reports (target_type, target_id)
  where resolved_at is null;

alter table public.content_reports enable row level security;

-- You may file a report and see your own. You may not see anyone else's, or count them: knowing how
-- close an item is to being hidden is exactly what someone organising a pile-on would want.
drop policy if exists content_reports_insert on public.content_reports;
create policy content_reports_insert on public.content_reports
  for insert with check (reporter_id = auth.uid());

drop policy if exists content_reports_read_own on public.content_reports;
create policy content_reports_read_own on public.content_reports
  for select using (reporter_id = auth.uid());

-- Nobody gets update or delete: a report is a record of something having been said, and resolving one
-- is an administrator's job, done with the service key (see supabase/moderation.sql).

/**
 * Hides an item once enough different people have reported it.
 *
 * This is a blunt instrument and worth being honest about: three coordinated accounts can hide
 * anything, and nothing here can tell a pile-on from a consensus. It is here because the alternative
 * for a project with one part-time administrator is worse - reported content staying up until someone
 * happens to read a queue. Hiding is reversible, costs the owner a gallery listing rather than their
 * work (the sprite stays in their library and in their tanks, and syncs as it always did), and every
 * report is kept so a human can look at what actually happened.
 *
 * The threshold is deliberately low for the same reason: a small project has few eyes.
 */
create or replace function public.autohide_reported() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  reporters integer;
begin
  select count(*) into reporters
  from public.content_reports r
  where r.target_type = new.target_type and r.target_id = new.target_id and r.resolved_at is null;

  if reporters >= 3 then
    if new.target_type = 'sprite' then
      update public.sprites set hidden_by_admin = true where id = new.target_id;
    else
      update public.tanks set hidden_by_admin = true where id = new.target_id;
    end if;
  end if;
  return new;
end;
$fn$;

drop trigger if exists content_reports_autohide on public.content_reports;
create trigger content_reports_autohide after insert on public.content_reports
  for each row execute function public.autohide_reported();

/**
 * The gallery listing.
 *
 * A function rather than a plain select so the rows can be trimmed: the sprites table carries
 * `user_id`, and a browsable listing has no reason to hand every visitor the account id behind every
 * drawing. What comes back is what it takes to draw a thumbnail and copy it.
 *
 * `before` pages backwards through `server_updated_at`, which is monotonic on the server (unlike the
 * client's updated_at - see the note above bump_rev), so paging cannot skip or repeat rows the way
 * an offset would while people keep publishing.
 */
create or replace function public.gallery_sprites(lim integer default 60, before timestamptz default null)
returns table (
  id text, name text, type text, width int, height int, frame_ms int, frames jsonb,
  forked_from text, server_updated_at timestamptz
)
language sql stable security definer set search_path = public as $fn$
  select s.id, s.name, s.type, s.width, s.height, s.frame_ms, s.frames, s.forked_from, s.server_updated_at
  from public.sprites s
  where s.visibility = 'public'
    and s.deleted_at = 0
    and not s.hidden_by_admin
    and (before is null or s.server_updated_at < before)
  order by s.server_updated_at desc
  limit least(greatest(lim, 1), 100);
$fn$;

revoke all on function public.gallery_sprites(integer, timestamptz) from public;
-- Browsing does not require an account; copying and reporting do (RLS decides both).
grant execute on function public.gallery_sprites(integer, timestamptz) to anon, authenticated;
