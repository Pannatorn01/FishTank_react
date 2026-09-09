/**
 * Row-level security, checked against the real project with two real accounts (plan P5-2).
 *
 *   node scripts/rls-smoke.cjs
 *
 * Pure HTTP, no browser: this checks what the database itself enforces, not what the app happens to
 * ask for - which is the only way to know whether one user can reach another's tank. Needs a .env with
 * a project, and anonymous sign-ins enabled on it. Everything it creates is deleted at the end.
 *
 * It caught a real hole: writing into a tank used to require only owning the *row*, not the tank.
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

const ANON_DISABLED_HINT = `Anonymous sign-ins are disabled on this project.

These probes need throwaway accounts, so turn them on for the run and off again afterwards:
  Supabase dashboard -> Authentication -> Sign In / Providers -> Allow anonymous sign-ins

Leaving them on lets anyone who has the (public) project URL create users in it, which is why
they are meant to be off except while testing.`;

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
    console.error(explainSignInFailure(json));
    process.exit(4);
  }
  return { token: json.access_token, userId: json.user.id };
}

/** A dead end that is nobody's bug deserves an instruction, not a stack trace. */
function explainSignInFailure(json) {
  if (json.error_code === 'anonymous_provider_disabled') {
    return `
${ANON_DISABLED_HINT}
`;
  }
  return `
Could not sign in: ${JSON.stringify(json)}
`;
}

function api(token) {
  return async (path, init = {}) => {
    const res = await fetch(`${URL}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
        ...(init.headers || {}),
      },
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}

(async () => {
  const a = await signInAnon();
  const b = await signInAnon();
  check('two real accounts created', !!a.token && !!b.token && a.userId !== b.userId, `${a.userId.slice(0, 8)} / ${b.userId.slice(0, 8)}`);

  const A = api(a.token);
  const B = api(b.token);
  const stamp = Date.now();
  const spriteId = `probe_sprite_${stamp}`;
  const tankId = `probe_tank_${stamp}`;

  // A writes a sprite and a tank.
  const wroteSprite = await A('sprites', {
    method: 'POST',
    body: JSON.stringify({
      id: spriteId,
      name: 'Probe',
      type: 'fish',
      width: 1,
      height: 1,
      frame_ms: 120,
      frames: [],
      updated_at: stamp,
      deleted_at: 0,
    }),
  });
  check('a signed-in user can write their own sprite', wroteSprite.status === 201, `HTTP ${wroteSprite.status} ${JSON.stringify(wroteSprite.body).slice(0, 120)}`);
  check('the server assigned rev (client never sends it)', wroteSprite.body?.[0]?.rev === 1, `rev=${wroteSprite.body?.[0]?.rev}`);
  check('the server assigned user_id from the session', wroteSprite.body?.[0]?.user_id === a.userId);

  const wroteTank = await A('tanks', {
    method: 'POST',
    body: JSON.stringify({ id: tankId, name: 'Probe tank', settings: { width: 900 }, updated_at: stamp, deleted_at: 0 }),
  });
  check('a signed-in user can write their own tank', wroteTank.status === 201, `HTTP ${wroteTank.status}`);

  const wroteInstance = await A('tank_instances', {
    method: 'POST',
    body: JSON.stringify({
      id: `probe_inst_${stamp}`,
      tank_id: tankId,
      sprite_id: spriteId,
      data: { x: 1, y: 2 },
      updated_at: stamp,
      deleted_at: 0,
    }),
  });
  check('a signed-in user can put a fish in their tank', wroteInstance.status === 201, `HTTP ${wroteInstance.status} ${JSON.stringify(wroteInstance.body).slice(0, 120)}`);

  // A sees their own work.
  const aReads = await A(`sprites?id=eq.${spriteId}&select=id`);
  check('the owner can read their own sprite back', aReads.body?.length === 1);

  // B must not.
  const bReadsSprite = await B(`sprites?id=eq.${spriteId}&select=id`);
  check("another account cannot read a private sprite", (bReadsSprite.body || []).length === 0, JSON.stringify(bReadsSprite.body));
  const bReadsTank = await B(`tanks?id=eq.${tankId}&select=id`);
  check("another account cannot read a private tank", (bReadsTank.body || []).length === 0, JSON.stringify(bReadsTank.body));
  const bReadsInstances = await B(`tank_instances?tank_id=eq.${tankId}&select=id`);
  check("another account cannot read a private tank's contents", (bReadsInstances.body || []).length === 0, JSON.stringify(bReadsInstances.body));

  // B must not be able to write into A's tank, or overwrite A's sprite.
  const bWrites = await B('tank_instances', {
    method: 'POST',
    body: JSON.stringify({ id: `evil_${stamp}`, tank_id: tankId, data: {}, updated_at: stamp, deleted_at: 0 }),
  });
  check('another account cannot add to a tank that is not theirs', bWrites.status >= 400, `HTTP ${bWrites.status}`);

  const bOverwrites = await B('sprites', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      id: spriteId,
      name: 'HIJACKED',
      type: 'fish',
      width: 1,
      height: 1,
      frame_ms: 120,
      frames: [],
      updated_at: stamp + 1,
      deleted_at: 0,
    }),
  });
  const stillMine = await A(`sprites?id=eq.${spriteId}&select=name`);
  check('another account cannot overwrite a sprite by upserting its id', stillMine.body?.[0]?.name === 'Probe', `HTTP ${bOverwrites.status}, name=${stillMine.body?.[0]?.name}`);

  // Sharing: once A shares the tank with B, B can read it - and still cannot write to it.
  await A('tank_shares', { method: 'POST', body: JSON.stringify({ tank_id: tankId, viewer_id: b.userId }) });
  const bReadsShared = await B(`tanks?id=eq.${tankId}&select=id`);
  check('a shared tank becomes readable by the viewer', bReadsShared.body?.length === 1, JSON.stringify(bReadsShared.body));
  const bReadsSharedContents = await B(`tank_instances?tank_id=eq.${tankId}&select=id`);
  check("a shared tank's contents are readable too (not an empty tank)", bReadsSharedContents.body?.length === 1);
  const bReadsSharedSprite = await B(`sprites?id=eq.${spriteId}&select=id`);
  check('sprites used by a shared tank become readable', bReadsSharedSprite.body?.length === 1);

  const bWritesShared = await B(`tanks?id=eq.${tankId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: 'HIJACKED' }),
  });
  const tankName = await A(`tanks?id=eq.${tankId}&select=name`);
  check('a viewer still cannot modify the shared tank', tankName.body?.[0]?.name === 'Probe tank', `HTTP ${bWritesShared.status}, name=${tankName.body?.[0]?.name}`);

  // A sprite in a private library stays private even after sharing a different tank.
  const otherSpriteId = `probe_private_${stamp}`;
  await A('sprites', {
    method: 'POST',
    body: JSON.stringify({
      id: otherSpriteId,
      name: 'Private',
      type: 'fish',
      width: 1,
      height: 1,
      frame_ms: 120,
      frames: [],
      updated_at: stamp,
      deleted_at: 0,
    }),
  });
  const bReadsOther = await B(`sprites?id=eq.${otherSpriteId}&select=id`);
  check('the rest of the library stays private after sharing one tank', (bReadsOther.body || []).length === 0);

  // Clean up everything this probe created.
  await A(`tank_shares?tank_id=eq.${tankId}`, { method: 'DELETE' });
  await A(`tank_instances?tank_id=eq.${tankId}`, { method: 'DELETE' });
  await A(`tanks?id=eq.${tankId}`, { method: 'DELETE' });
  await A(`sprites?id=eq.${spriteId}`, { method: 'DELETE' });
  await A(`sprites?id=eq.${otherSpriteId}`, { method: 'DELETE' });
  const leftovers = await A(`sprites?id=like.probe_*&select=id`);
  check('probe rows cleaned up', (leftovers.body || []).length === 0, JSON.stringify(leftovers.body));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('CRASH', e);
  process.exit(2);
});
