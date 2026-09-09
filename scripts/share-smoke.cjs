/**
 * Sharing a tank, checked against the real project with two real accounts (plan P6-3).
 *
 *   node scripts/share-smoke.cjs
 *
 * Same shape and same reasoning as rls-smoke.cjs: pure HTTP, no browser, because the question is what
 * the database enforces, not what the app remembers to ask for. Needs a .env with a project, and
 * anonymous sign-ins temporarily enabled on it (Authentication -> Sign In / Providers). Turn them back
 * off afterwards - with them on, anyone can create users in your project.
 *
 * Everything it creates is deleted at the end.
 *
 * One limit worth knowing: anonymous accounts have no email address, so the email half of sharing
 * (share_tank / tank_share_list resolving a real address) can only be checked as far as "an invitation
 * for an address with no account is recorded, and the wrong person cannot invite anyone". The rest of
 * that path needs two real mailboxes and is checked by hand.
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

function rpc(call) {
  return (name, args) => call(`rpc/${name}`, { method: 'POST', body: JSON.stringify(args ?? {}) });
}

const now = Date.now();
const TANK = `tank_smoke_${now}`;
const FISH_SPRITE = `sprite_smoke_fish_${now}`;
const DECOR_SPRITE = `sprite_smoke_decor_${now}`;
const BG_SPRITE = `sprite_smoke_bg_${now}`;
const PRIVATE_SPRITE = `sprite_smoke_private_${now}`;
const SLUG = `slug_smoke_${now}`;

(async () => {
  const a = await signInAnon();
  const b = await signInAnon();
  const A = api(a.token);
  const B = api(b.token);
  const anon = api(null);
  const rpcA = rpc(A);
  const rpcB = rpc(B);
  const rpcAnon = rpc(anon);
  check('two real accounts created', !!a.token && !!b.token && a.userId !== b.userId);

  // ---------------------------------------------------------------- A builds a tank
  const sprite = (id, name, type) => ({
    id,
    name,
    type,
    width: 1,
    height: 1,
    frame_ms: 120,
    frames: [[{ id: 'l', name: 'Layer 1', visible: true, opacity: 1, cells: ['#fff'] }]],
    updated_at: now,
    deleted_at: 0,
  });

  await A('sprites', {
    method: 'POST',
    body: JSON.stringify([
      sprite(FISH_SPRITE, 'Smoke fish', 'fish'),
      sprite(DECOR_SPRITE, 'Smoke decor', 'room'),
      sprite(BG_SPRITE, 'Smoke background', 'background'),
      sprite(PRIVATE_SPRITE, 'Not in the tank', 'fish'),
    ]),
  });

  const tank = await A('tanks', {
    method: 'POST',
    body: JSON.stringify({
      id: TANK,
      name: 'Smoke tank',
      settings: { width: 400, height: 300, backgroundSpriteId: BG_SPRITE },
      updated_at: now,
      deleted_at: 0,
    }),
  });
  check('A created a tank', tank.status === 201, `status ${tank.status}`);

  const instance = await A('tank_instances', {
    method: 'POST',
    body: JSON.stringify({
      id: `inst_${now}`,
      tank_id: TANK,
      sprite_id: FISH_SPRITE,
      data: { spriteId: FISH_SPRITE, kind: 'fish', x: 10, y: 10 },
      updated_at: now,
      deleted_at: 0,
    }),
  });
  check('A put a fish in it', instance.status === 201, `status ${instance.status}`);

  // The regression this whole column exists for: the client sends sprite_id for room decor too, and
  // before P6-3 room_instances had no such column, so every one of these was rejected and retried
  // forever in the outbox.
  const decor = await A('room_instances', {
    method: 'POST',
    body: JSON.stringify({
      id: `room_${now}`,
      tank_id: TANK,
      sprite_id: DECOR_SPRITE,
      data: { spriteId: DECOR_SPRITE, x: 5, y: 5, visible: true },
      updated_at: now,
      deleted_at: 0,
    }),
  });
  check('room decor uploads with its sprite_id', decor.status === 201, `status ${decor.status}`);

  const group = await A('tank_groups', {
    method: 'POST',
    body: JSON.stringify({ id: `grp_${now}`, tank_id: TANK, data: { name: 'School', zone: null }, updated_at: now, deleted_at: 0 }),
  });
  check('a group uploads without a sprite_id', group.status === 201, `status ${group.status}`);

  // ---------------------------------------------------------------- private by default
  check('a new tank is private', (await A(`tanks?id=eq.${TANK}&select=visibility`)).body[0].visibility === 'private');
  check('B cannot see A private tank', (await B(`tanks?id=eq.${TANK}`)).body.length === 0);
  check('B get_shared_tank on a private tank returns nothing', (await rpcB('get_shared_tank', { t_id: TANK, slug: null })).body === null);
  // The one that mattered. A caller with no session at all makes auth.uid() NULL, which made the
  // function's hand-built `allowed` boolean NULL rather than false - and `if not NULL` runs neither
  // branch, so the guard was skipped and every private tank came back in full to anyone who sent no
  // credentials. Checked before the sharing tests rather than after, because it is not really a test
  // about sharing: it is the question of whether the function refuses by default.
  const nobody = await rpcAnon('get_shared_tank', { t_id: TANK, slug: null });
  check('a caller with no session gets nothing for a private tank', nobody.body === null, JSON.stringify(nobody.body)?.slice(0, 60));

  // ---------------------------------------------------------------- unlisted, by slug
  await A(`tanks?id=eq.${TANK}`, { method: 'PATCH', body: JSON.stringify({ visibility: 'unlisted', share_slug: SLUG }) });

  const withSlug = await rpcAnon('get_shared_tank', { t_id: TANK, slug: SLUG });
  check('anyone holding the link can open an unlisted tank', !!withSlug.body && withSlug.body.tank.id === TANK);
  check('the link brings the fish with it', (withSlug.body?.instances ?? []).length === 1);
  check('and the room decor', (withSlug.body?.room ?? []).length === 1);

  const spriteIds = (withSlug.body?.sprites ?? []).map((s) => s.id).sort();
  check('and every sprite the tank uses - fish, decor, background', JSON.stringify(spriteIds) === JSON.stringify([BG_SPRITE, DECOR_SPRITE, FISH_SPRITE].sort()), spriteIds.join(','));
  check('but nothing else from the owner library', !spriteIds.includes(PRIVATE_SPRITE));

  check('a wrong slug opens nothing', (await rpcAnon('get_shared_tank', { t_id: TANK, slug: 'wrong' })).body === null);
  check('no slug opens nothing', (await rpcAnon('get_shared_tank', { t_id: TANK, slug: null })).body === null);
  // The id is not the secret: knowing it, without the slug, gets a stranger nothing through the tables.
  check('an unlisted tank is not readable by id alone', (await B(`tanks?id=eq.${TANK}`)).body.length === 0);
  check('nor are its contents', (await B(`tank_instances?tank_id=eq.${TANK}`)).body.length === 0);

  // ---------------------------------------------------------------- shared with one person
  await A(`tanks?id=eq.${TANK}`, { method: 'PATCH', body: JSON.stringify({ visibility: 'private' }) });
  const shared = await A('tank_shares', {
    method: 'POST',
    body: JSON.stringify({ tank_id: TANK, viewer_id: b.userId, role: 'viewer' }),
  });
  check('A shared the tank with B', shared.status === 201, `status ${shared.status}`);

  const asB = await rpcB('get_shared_tank', { t_id: TANK, slug: null });
  check('B can now open it, with no link at all', !!asB.body && asB.body.tank.id === TANK);
  check('B sees it listed as shared with them', ((await rpcB('tanks_shared_with_me')).body ?? []).some((t) => t.id === TANK));

  const write = await B(`tanks?id=eq.${TANK}`, { method: 'PATCH', body: JSON.stringify({ name: 'Mine now' }) });
  check('B still cannot change it', (write.body ?? []).length === 0, `status ${write.status}`);
  const writeChild = await B('tank_instances', {
    method: 'POST',
    body: JSON.stringify({ id: `inst_b_${now}`, tank_id: TANK, data: {}, updated_at: now, deleted_at: 0 }),
  });
  check('nor put anything into it', writeChild.status === 401 || writeChild.status === 403, `status ${writeChild.status}`);

  // ---------------------------------------------------------------- invitations
  const invited = `smoke-${now}@example.invalid`;
  const invite = await rpcA('share_tank', { t_id: TANK, viewer_email: invited });
  check('A can invite an address with no account', invite.status === 204 || invite.status === 200, `status ${invite.status}`);
  const list = await rpcA('tank_share_list', { t_id: TANK });
  check('the invitation is waiting', (list.body ?? []).some((r) => r.email === invited && r.pending));

  const notMine = await rpcB('share_tank', { t_id: TANK, viewer_email: invited });
  check('B cannot invite anyone to A tank', notMine.status >= 400, `status ${notMine.status}`);
  check('B cannot read who A shared with', ((await rpcB('tank_share_list', { t_id: TANK })).body ?? []).length === 0);

  const badEmail = await rpcA('share_tank', { t_id: TANK, viewer_email: 'not-an-email' });
  check('a malformed address is refused', badEmail.status >= 400, `status ${badEmail.status}`);

  await rpcA('unshare_tank', { t_id: TANK, viewer_email: invited });
  check('unshare removes the invitation', !((await rpcA('tank_share_list', { t_id: TANK })).body ?? []).some((r) => r.email === invited));

  // ---------------------------------------------------------------- clean up
  await A(`tank_shares?tank_id=eq.${TANK}`, { method: 'DELETE' });
  await A(`tank_instances?tank_id=eq.${TANK}`, { method: 'DELETE' });
  await A(`room_instances?tank_id=eq.${TANK}`, { method: 'DELETE' });
  await A(`tank_groups?tank_id=eq.${TANK}`, { method: 'DELETE' });
  await A(`tanks?id=eq.${TANK}`, { method: 'DELETE' });
  await A(`sprites?id=in.(${[FISH_SPRITE, DECOR_SPRITE, BG_SPRITE, PRIVATE_SPRITE].join(',')})`, { method: 'DELETE' });
  check('everything it created is gone', (await A(`tanks?id=eq.${TANK}`)).body.length === 0);

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
