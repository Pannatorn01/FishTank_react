-- Moderation queue for Pixel Fish Tank. Run these in the Supabase SQL editor, as the project owner.
--
-- There is deliberately no moderation screen in the app. An in-app one needs an administrator role,
-- which needs a way to grant it, revoke it, and audit it - a bigger thing to get wrong than the queue
-- it would replace, for a project with one administrator who already has the SQL editor open. These
-- queries are that queue.
--
-- Reports are readable only by whoever filed them (schema.sql: content_reports_read_own), so nothing
-- below works from the browser. That is the point.

-- ---------------------------------------------------------------- what needs looking at
-- Open reports, most-reported first, with what the item is and whether it is already hidden.
select
  r.target_type,
  r.target_id,
  count(*)                                        as reports,
  min(r.created_at)                               as first_reported,
  max(r.created_at)                               as last_reported,
  array_remove(array_agg(nullif(r.reason, '')), null) as reasons,
  coalesce(s.name, t.name)                        as item_name,
  coalesce(s.hidden_by_admin, t.hidden_by_admin)  as hidden,
  coalesce(s.user_id, t.user_id)                  as owner_id
from public.content_reports r
left join public.sprites s on r.target_type = 'sprite' and s.id = r.target_id
left join public.tanks   t on r.target_type = 'tank'   and t.id = r.target_id
where r.resolved_at is null
group by r.target_type, r.target_id, s.name, t.name, s.hidden_by_admin, t.hidden_by_admin, s.user_id, t.user_id
order by reports desc, last_reported desc;

-- ---------------------------------------------------------------- look at one item
-- The sprite itself. `frames` is run-length encoded (src/lib/pixelCodec.ts), so this shows the shape
-- of the thing rather than a picture of it; paste the row into the app's importer to actually see it.
-- select * from public.sprites where id = 'sprite_...';

-- ---------------------------------------------------------------- act
-- Hide something (this is what three reports do automatically - see autohide_reported).
-- update public.sprites set hidden_by_admin = true  where id = 'sprite_...';
-- update public.tanks   set hidden_by_admin = true  where id = 'tank_...';

-- Put it back. Reports stay on file; resolve them below so the item leaves the queue.
-- update public.sprites set hidden_by_admin = false where id = 'sprite_...';
-- update public.tanks   set hidden_by_admin = false where id = 'tank_...';

-- Close the reports on an item once it has been dealt with, either way. Resolved reports no longer
-- count towards the auto-hide threshold, so an item that was cleared does not get hidden again by the
-- same three reports the moment a fourth arrives.
-- update public.content_reports set resolved_at = now()
--  where target_type = 'sprite' and target_id = 'sprite_...' and resolved_at is null;

-- ---------------------------------------------------------------- who is reporting
-- Someone filing many reports that all end up cleared is worth noticing: the auto-hide only needs
-- three people, so a small group can use it as a weapon.
-- select reporter_id, count(*) filter (where resolved_at is not null) as closed, count(*) as total
--   from public.content_reports group by reporter_id order by total desc;
