/**
 * The public tank listing, checked against the real project (plan P6-6).
 *
 *   node scripts/tank-gallery-smoke.cjs
 *
 * Pure HTTP, no browser: what is being checked is which tanks the database is willing to list and to
 * whom, which is not a question the app can answer about itself. Needs a .env with a project, and
 * anonymous sign-ins enabled on it (Authentication -> Sign In / Providers) - turn them off again
 * afterwards. Everything it creates is deleted at the end, except the reports, which nobody may
 * delete by design (see the note at the bottom).
 *
 * The check that matters most here is the one about unlisted tanks: `unlisted` and `public` differ by
 * one word in a column, and a listing that got the filter wrong would publish every tank anyone had
 * ever made a private link for, silently.
 */
const fs = require('fs');

const env = Object.fromEntries(
  fs
    .readFileSync('.env', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const URL = env.VITE_SUPABASE_URL;
const KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY;

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  :: ' + detail : ''}`);
}

async function signInAnon() {
  const res = await fetch(`${URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: {} }),
  });
  const json = await res.json();
  if (!json.access_token) {
    console.error(`\nAnonymous sign-ins are disabled on this project.\n\nTurn them on for the run and off again afterwards:\n  Supabase dashboard -> Authentication -> Sign In / Providers -> Allow anonymous sign-ins\n`);
    process.exit(2);
  }
  return { token: json.access_token, userId: json.user.id };
}

function api(token) {
  return async (path, init = {}) => {
    const res = await fetch(`${URL}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: KEY,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
        ...(init.headers || {}),
      },
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}

const rpc = (call) => (name, args) => call(`rpc/${name}`, { method: 'POST', body: JSON.stringify(args ?? {}) });

const now = Date.now();
const SPRITE = `sprite_tg_${now}`;
const PUBLIC_TANK = `tank_tg_public_${now}`;
const UNLISTED_TANK = `tank_tg_unlisted_${now}`;
const PRIVATE_TANK = `tank_tg_private_${now}`;
const REPORTED_TANK = `tank_tg_reported_${now}`;
const SLUG = `slug_tg_${now}`;
const ALL_TANKS = [PUBLIC_TANK, UNLISTED_TANK, PRIVATE_TANK, REPORTED_TANK];

(async () => {
  const a = await signInAnon();
  const A = api(a.token);
  const anon = api(null);
  const rpcAnon = rpc(anon);

  await A('sprites', {
    method: 'POST',
    body: JSON.stringify({
      id: SPRITE, name: 'Gallery fish', type: 'fish', width: 1, height: 1, frame_ms: 120,
      frames: [[{ id: 'l', name: 'Layer 1', visible: true, opacity: 1, cells: ['#fff'] }]],
      updated_at: now, deleted_at: 0,
    }),
  });

  const made = await A('tanks', {
    method: 'POST',
    body: JSON.stringify(
      ALL_TANKS.map((id) => ({
        id,
        name: `Smoke ${id.includes('public') ? 'public' : id.includes('unlisted') ? 'unlisted' : id.includes('reported') ? 'reported' : 'private'} tank`,
        settings: { width: 400, height: 300 },
        updated_at: now,
        deleted_at: 0,
      }))
    ),
  });
  check('four tanks created', made.status === 201, `status ${made.status}`);

  // Two fish in the public one, so the count on the card can be checked against something that is not 0.
  const fish = await A('tank_instances', {
    method: 'POST',
    body: JSON.stringify([1, 2].map((n) => ({
      id: `inst_tg_${n}_${now}`, tank_id: PUBLIC_TANK, sprite_id: SPRITE,
      data: { spriteId: SPRITE, kind: 'fish', x: 10 * n, y: 10 * n }, updated_at: now, deleted_at: 0,
    }))),
  });
  check('two fish put in the public one', fish.status === 201, `status ${fish.status}`);

  await A(`tanks?id=eq.${PUBLIC_TANK}`, { method: 'PATCH', body: JSON.stringify({ visibility: 'public' }) });
  await A(`tanks?id=eq.${REPORTED_TANK}`, { method: 'PATCH', body: JSON.stringify({ visibility: 'public' }) });
  await A(`tanks?id=eq.${UNLISTED_TANK}`, { method: 'PATCH', body: JSON.stringify({ visibility: 'unlisted', share_slug: SLUG }) });

  // ---------------------------------------------------------------- the listing
  const listed = await rpcAnon('gallery_tanks', { lim: 100, before: null });
  check('the listing is readable without an account', listed.status === 200, `status ${listed.status}`);
  const ids = (listed.body ?? []).map((t) => t.id);

  check('a public tank is listed', ids.includes(PUBLIC_TANK));
  check('a private tank is not', !ids.includes(PRIVATE_TANK));
  // The one that would be quiet and total if it were wrong.
  check('an UNLISTED tank is not - a private link must not become a listing', !ids.includes(UNLISTED_TANK));

  const card = (listed.body ?? []).find((t) => t.id === PUBLIC_TANK) ?? {};
  check('the card counts the fish in it', card.fish_count === 2, JSON.stringify(card.fish_count));
  check('the card carries a name', card.name === 'Smoke public tank', card.name);
  // `tanks` holds both, and a listing anyone can read has no business handing out either - the slug
  // especially, since it is the only thing protecting every unlisted tank.
  check('the card leaks no user_id and no share_slug', !('user_id' in card) && !('share_slug' in card), Object.keys(card).join(','));

  // ---------------------------------------------------------------- opening from the listing
  const opened = await rpcAnon('get_shared_tank', { t_id: PUBLIC_TANK, slug: null });
  check('a listed tank opens with no link and no account', !!opened.body && opened.body.tank.id === PUBLIC_TANK);
  check('and arrives with its fish', (opened.body?.instances ?? []).length === 2);
  check('and the sprite they use', (opened.body?.sprites ?? []).some((s) => s.id === SPRITE));

  // ---------------------------------------------------------------- paging
  const firstPage = await rpcAnon('gallery_tanks', { lim: 1, before: null });
  check('paging returns one row when asked for one', (firstPage.body ?? []).length === 1, `${(firstPage.body ?? []).length}`);
  const nextPage = await rpcAnon('gallery_tanks', { lim: 1, before: firstPage.body[0].server_updated_at });
  check('and the next page is a different tank', (nextPage.body ?? []).length === 0 || nextPage.body[0].id !== firstPage.body[0].id);

  // ---------------------------------------------------------------- moderation
  // Three different accounts, because the auto-hide counts reporters and not reports - one person
  // filing three times is the thing the primary key on content_reports exists to prevent.
  const reporters = [a, await signInAnon(), await signInAnon()];
  for (const r of reporters) {
    await api(r.token)('content_reports', {
      method: 'POST',
      body: JSON.stringify({ target_type: 'tank', target_id: REPORTED_TANK, reason: 'probe' }),
      headers: { Prefer: 'resolution=merge-duplicates' },
    });
  }
  const afterReports = await rpcAnon('gallery_tanks', { lim: 100, before: null });
  check('three reporters take a tank off the listing', !(afterReports.body ?? []).map((t) => t.id).includes(REPORTED_TANK));
  const hiddenOpen = await rpcAnon('get_shared_tank', { t_id: REPORTED_TANK, slug: null });
  check('and it cannot be opened any more either', hiddenOpen.body === null);
  check('the tank that was not reported is untouched', (afterReports.body ?? []).map((t) => t.id).includes(PUBLIC_TANK));

  // ---------------------------------------------------------------- unpublishing
  await A(`tanks?id=eq.${PUBLIC_TANK}`, { method: 'PATCH', body: JSON.stringify({ visibility: 'private' }) });
  const afterUnpublish = await rpcAnon('gallery_tanks', { lim: 100, before: null });
  check('taking a tank off the list removes it immediately', !(afterUnpublish.body ?? []).map((t) => t.id).includes(PUBLIC_TANK));

  // ---------------------------------------------------------------- clean up
  await A(`tank_instances?tank_id=in.(${ALL_TANKS.join(',')})`, { method: 'DELETE' });
  await A(`tanks?id=in.(${ALL_TANKS.join(',')})`, { method: 'DELETE' });
  await A(`sprites?id=eq.${SPRITE}`, { method: 'DELETE' });
  check('the tanks it created are gone', (await A(`tanks?id=in.(${ALL_TANKS.join(',')})`)).body.length === 0);
  // Reports are deliberately not deletable by anyone - they are a record of something having been
  // said (schema.sql: no update or delete policy on content_reports). Clearing the probe rows is an
  // administrator's job:
  //   delete from public.content_reports where target_id like 'tank_tg_%';
  console.log(`\nleft behind on purpose: report rows for ${REPORTED_TANK} (only an admin can delete those)`);

  const failed = results.filter((r) => !r.ok).length;
  console.log(`${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
