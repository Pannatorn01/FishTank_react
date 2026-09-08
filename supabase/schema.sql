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
alter table public.sprites        enable row level security;
alter table public.tanks          enable row level security;
alter table public.tank_instances enable row level security;
alter table public.tank_groups    enable row level security;
alter table public.room_instances enable row level security;
alter table public.tank_shares    enable row level security;
alter table public.user_prefs     enable row level security;

-- Owners do anything with their own rows. Written as four explicit policies rather than `for all`
-- so that the read policies below can widen SELECT without also widening writes.
drop policy if exists sprites_owner_rw on public.sprites;
create policy sprites_owner_rw on public.sprites
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists tanks_owner_rw on public.tanks;
create policy tanks_owner_rw on public.tanks
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists tank_instances_owner_rw on public.tank_instances;
create policy tank_instances_owner_rw on public.tank_instances
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists tank_groups_owner_rw on public.tank_groups;
create policy tank_groups_owner_rw on public.tank_groups
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists room_instances_owner_rw on public.room_instances;
create policy room_instances_owner_rw on public.room_instances
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists user_prefs_owner_rw on public.user_prefs;
create policy user_prefs_owner_rw on public.user_prefs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Only the tank's owner manages who it is shared with; a viewer can see the row naming them.
drop policy if exists tank_shares_owner_rw on public.tank_shares;
create policy tank_shares_owner_rw on public.tank_shares
  for all using (exists (select 1 from public.tanks t where t.id = tank_id and t.user_id = auth.uid()))
  with check (exists (select 1 from public.tanks t where t.id = tank_id and t.user_id = auth.uid()));

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
      or exists (select 1 from public.tank_shares s where s.tank_id = id and s.viewer_id = auth.uid())
    )
  );

-- What is inside a readable tank has to be readable too, or a shared tank shows up empty.
drop policy if exists tank_instances_shared_read on public.tank_instances;
create policy tank_instances_shared_read on public.tank_instances
  for select using (
    exists (
      select 1 from public.tanks t
      where t.id = tank_id and t.deleted_at = 0 and not t.hidden_by_admin
        and (t.visibility in ('public', 'unlisted')
             or exists (select 1 from public.tank_shares s where s.tank_id = t.id and s.viewer_id = auth.uid()))
    )
  );

drop policy if exists tank_groups_shared_read on public.tank_groups;
create policy tank_groups_shared_read on public.tank_groups
  for select using (
    exists (
      select 1 from public.tanks t
      where t.id = tank_id and t.deleted_at = 0 and not t.hidden_by_admin
        and (t.visibility in ('public', 'unlisted')
             or exists (select 1 from public.tank_shares s where s.tank_id = t.id and s.viewer_id = auth.uid()))
    )
  );

drop policy if exists room_instances_shared_read on public.room_instances;
create policy room_instances_shared_read on public.room_instances
  for select using (
    exists (
      select 1 from public.tanks t
      where t.id = tank_id and t.deleted_at = 0 and not t.hidden_by_admin
        and (t.visibility in ('public', 'unlisted')
             or exists (select 1 from public.tank_shares s where s.tank_id = t.id and s.viewer_id = auth.uid()))
    )
  );

-- Sprites are readable when they are public (the gallery) or when a tank you can see uses them.
-- Everything else in the owner's library stays private.
drop policy if exists sprites_shared_read on public.sprites;
create policy sprites_shared_read on public.sprites
  for select using (
    (deleted_at = 0 and not hidden_by_admin and visibility = 'public')
    or exists (
      select 1
      from public.tank_instances i
      join public.tanks t on t.id = i.tank_id
      where i.sprite_id = id and t.deleted_at = 0 and not t.hidden_by_admin
        and (t.visibility in ('public', 'unlisted')
             or exists (select 1 from public.tank_shares s where s.tank_id = t.id and s.viewer_id = auth.uid()))
    )
  );

-- ---------------------------------------------------------------- server-assigned revisions
-- `rev` breaks ties when two devices' clocks disagree closely enough that updated_at cannot. It is
-- assigned here rather than by the client for the obvious reason: a client cannot be trusted to know
-- what the previous revision was.
create or replace function public.bump_rev() returns trigger as $$
begin
  new.rev := coalesce(old.rev, 0) + 1;
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
