/**
 * The public gallery and the reporting that guards it, against the real project (plan P6-4/P6-5).
 *
 *   node scripts/gallery-smoke.cjs
 *
 * Pure HTTP, no browser: this checks what the database itself allows, which is the only thing standing
 * between a published sprite and the rest of its author's library. Needs a .env with a project, and
 * anonymous sign-ins enabled on it. Everything it creates is deleted at the end.
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
    console.error(
      json.error_code === 'anonymous_provider_disabled'
        ? `\n${ANON_DISABLED_HINT}\n`
        : `\nCould not sign in: ${JSON.stringify(json)}\n`
    );
    process.exit(4);
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

function rpc(token) {
  return async (fn, args) => {
    const res = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: KEY,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args ?? {}),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}

function spriteBody(id, name, extra = {}) {
  return {
    id,
    name,
    type: 'fish',
    width: 1,
    height: 1,
    frame_ms: 120,
    frames: [],
    updated_at: Date.now(),
    deleted_at: 0,
    ...extra,
  };
}

(async () => {
  const author = await signInAnon();
  const visitor = await signInAnon();
  const A = api(author.token);
  const V = api(visitor.token);
  const Vrpc = rpc(visitor.token);
  const anonRpc = rpc(null);

  const stamp = Date.now();
  const publicId = `probe_pub_${stamp}`;
  const privateId = `probe_priv_${stamp}`;

  // ---- publishing -------------------------------------------------------------------
  await A('sprites', { method: 'POST', body: JSON.stringify(spriteBody(publicId, 'Probe Public')) });
  await A('sprites', { method: 'POST', body: JSON.stringify(spriteBody(privateId, 'Probe Private')) });

  const beforePublish = await Vrpc('gallery_sprites', { lim: 100 });
  check('a new sprite is not in the gallery by default', !(beforePublish.body ?? []).some((s) => s.id === publicId));

  const published = await A(`sprites?id=eq.${publicId}`, { method: 'PATCH', body: JSON.stringify({ visibility: 'public' }) });
  check('the owner can publish their own sprite', published.status === 200 && published.body?.[0]?.visibility === 'public', `HTTP ${published.status}`);

  const listed = await Vrpc('gallery_sprites', { lim: 100 });
  const entry = (listed.body ?? []).find((s) => s.id === publicId);
  check('a published sprite appears in the gallery for someone else', !!entry, `${(listed.body ?? []).length} listed`);
  check('the gallery hides the private one', !(listed.body ?? []).some((s) => s.id === privateId));
  check('the gallery does not hand out the author account id', entry && !('user_id' in entry), entry && Object.keys(entry).join(','));

  const anonListed = await anonRpc('gallery_sprites', { lim: 100 });
  check('browsing the gallery works signed out', (anonListed.body ?? []).some((s) => s.id === publicId), `HTTP ${anonListed.status}`);

  // Publishing one sprite must not open the rest of the library.
  const visitorReadsPrivate = await V(`sprites?id=eq.${privateId}&select=id`);
  check('publishing one sprite does not expose the others', (visitorReadsPrivate.body ?? []).length === 0);

  const visitorEdits = await V(`sprites?id=eq.${publicId}`, { method: 'PATCH', body: JSON.stringify({ name: 'HIJACKED' }) });
  const stillNamed = await A(`sprites?id=eq.${publicId}&select=name`);
  check('a visitor cannot edit a published sprite', stillNamed.body?.[0]?.name === 'Probe Public', `HTTP ${visitorEdits.status}`);

  // ---- forking ----------------------------------------------------------------------
  const forkId = `probe_fork_${stamp}`;
  const forked = await V('sprites', {
    method: 'POST',
    body: JSON.stringify(spriteBody(forkId, 'Probe Public', { forked_from: publicId })),
  });
  check('a visitor can copy a gallery sprite into their own library', forked.status === 201, `HTTP ${forked.status}`);
  check('the copy belongs to the person who took it', forked.body?.[0]?.user_id === visitor.userId);
  check('the copy is private by default', forked.body?.[0]?.visibility === 'private');
  check('the copy records where it came from', forked.body?.[0]?.forked_from === publicId);

  // Unpublishing the original leaves the copy alone - the whole reason a fork is a copy.
  await A(`sprites?id=eq.${publicId}`, { method: 'PATCH', body: JSON.stringify({ visibility: 'private' }) });
  const copyAfterUnpublish = await V(`sprites?id=eq.${forkId}&select=id,name`);
  check('unpublishing the original does not touch copies of it', copyAfterUnpublish.body?.length === 1);
  await A(`sprites?id=eq.${publicId}`, { method: 'PATCH', body: JSON.stringify({ visibility: 'public' }) });

  // ---- reporting --------------------------------------------------------------------
  const reported = await V('content_reports', {
    method: 'POST',
    body: JSON.stringify({ target_type: 'sprite', target_id: publicId, reason: 'probe' }),
  });
  check('a signed-in visitor can report a sprite', reported.status === 201, `HTTP ${reported.status} ${JSON.stringify(reported.body).slice(0, 120)}`);

  const authorReadsReports = await A(`content_reports?target_id=eq.${publicId}&select=reporter_id`);
  check("the reported author cannot read the reports against them", (authorReadsReports.body ?? []).length === 0, JSON.stringify(authorReadsReports.body));
  const ownReports = await V(`content_reports?target_id=eq.${publicId}&select=target_id`);
  check('a reporter can see their own report', (ownReports.body ?? []).length === 1);

  const anonReport = await api(null)('content_reports', {
    method: 'POST',
    body: JSON.stringify({ target_type: 'sprite', target_id: publicId, reason: 'probe' }),
  });
  check('reporting requires an account', anonReport.status >= 400, `HTTP ${anonReport.status}`);

  // One person, one report: the primary key is what stops a single account reaching the threshold.
  const duplicate = await V('content_reports', {
    method: 'POST',
    body: JSON.stringify({ target_type: 'sprite', target_id: publicId, reason: 'again' }),
  });
  check('the same person cannot report the same item twice', duplicate.status >= 400, `HTTP ${duplicate.status}`);

  const stillListedAfterOne = await Vrpc('gallery_sprites', { lim: 100 });
  check('one report does not hide anything', (stillListedAfterOne.body ?? []).some((s) => s.id === publicId));

  // ---- auto-hide at three different reporters ---------------------------------------
  const second = await signInAnon();
  const third = await signInAnon();
  for (const who of [second, third]) {
    await api(who.token)('content_reports', {
      method: 'POST',
      body: JSON.stringify({ target_type: 'sprite', target_id: publicId, reason: 'probe' }),
    });
  }

  const afterThree = await Vrpc('gallery_sprites', { lim: 100 });
  check('three separate reports take an item out of the gallery', !(afterThree.body ?? []).some((s) => s.id === publicId));

  const ownerStillHasIt = await A(`sprites?id=eq.${publicId}&select=id,hidden_by_admin`);
  check('hiding does not take the sprite away from its author', ownerStillHasIt.body?.length === 1, JSON.stringify(ownerStillHasIt.body));
  check('the hidden flag is what changed', ownerStillHasIt.body?.[0]?.hidden_by_admin === true);

  // ---- cleanup ----------------------------------------------------------------------
  await A(`sprites?id=eq.${publicId}`, { method: 'DELETE' });
  await A(`sprites?id=eq.${privateId}`, { method: 'DELETE' });
  await V(`sprites?id=eq.${forkId}`, { method: 'DELETE' });
  const leftover = await A(`sprites?id=like.probe_*&select=id`);
  check('probe sprites cleaned up', (leftover.body ?? []).length === 0, JSON.stringify(leftover.body));
  console.log(
    '\nNote: the content_reports rows this created cannot be deleted from the client by design ' +
      '(reports are append-only). Clear them in the SQL editor if you want a clean table:\n' +
      `  delete from public.content_reports where target_id like 'probe_%';`
  );

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('CRASH', e);
  process.exit(2);
});
