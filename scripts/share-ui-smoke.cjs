/**
 * The sharing UI, driven in a real browser (plan P6-3).
 *
 *   npm run dev                     # in another terminal
 *   node scripts/share-ui-smoke.cjs
 *
 * share-smoke.cjs checks what the database allows; this checks that the app actually asks for it - the
 * owner can turn a link on and copy it, and someone who is not signed in at all can open that link and
 * gets a tank they cannot edit. The two halves fail in different ways: a database that refuses
 * correctly is no use behind a panel that never calls it.
 *
 * Needs a .env with a project, anonymous sign-ins enabled on it, and `npm run dev` running.
 * Everything it creates on the server is deleted at the end.
 */
const fs = require('fs');
const { chromium } = require('playwright');

const env = Object.fromEntries(
  fs
    .readFileSync('.env', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const SUPA = env.VITE_SUPABASE_URL;
const KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY;
const URL = 'http://localhost:5173/';

const killer = setTimeout(() => {
  console.error('HARD TIMEOUT');
  process.exit(3);
}, 180000);
killer.unref?.();

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

(async () => {
  const browser = await chromium.launch();
  const owner = await browser.newContext();
  const page = await owner.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.setDefaultTimeout(20000);

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas.pixel-canvas');

  await page.evaluate(async () => {
    const mod = await import('/src/lib/supabase.ts');
    const { error } = await mod.getSupabase().auth.signInAnonymously();
    if (error) throw new Error(`ANON_SIGNIN_FAILED: ${error.message}`);
  });
  const token = await page.evaluate(async () => {
    const mod = await import('/src/lib/supabase.ts');
    const { data } = await mod.getSupabase().auth.getSession();
    return data.session.access_token;
  });

  // Sharing needs the tank to exist on the server, which is what the first-sign-in upload does.
  await page.waitForSelector('[role="alertdialog"]');
  await page.getByRole('button', { name: /Upload it/i }).click();
  await page.waitForTimeout(4000);
  await page.getByRole('button', { name: /^OK$/ }).click();
  await page.waitForTimeout(300);

  // Put a fish in the tank before sharing it. Without this the whole viewer half of this script would
  // pass against an empty tank, which is precisely the failure it is supposed to catch: a shared tank
  // that arrives with no contents looks identical to one that arrives correctly and happens to be bare.
  const placed = await page.evaluate(async () => {
    const mod = await import('/src/lib/data/index.ts');
    const repos = mod.getRepos();
    await repos.sprites.hydrate();
    const sprite = repos.sprites.list().find((s) => s.type === 'fish') ?? repos.sprites.list()[0];
    const tankId = await repos.tank.currentId();
    const state = await repos.tank.load(tankId);
    const now = Date.now();
    state.instances = [
      ...state.instances,
      {
        id: 'inst_share_probe', spriteId: sprite.id, kind: sprite.type, x: 60, y: 60, dir: 1, vx: 10, vy: 2,
        targetY: 60, frameIndex: 0, frameTimer: 0, bobPhase: 0, isDragging: false, swimSpeed: 'medium',
        groupId: null, schoolOffsetY: 0, zone: null, visible: true, bornAt: now, lifespanMs: 9e8,
        dead: false, diedAt: 0, hunger: 1, starvingSince: 0, matureAt: now, wellFedSince: 0,
        updatedAt: now, deletedAt: 0, rev: 0,
      },
    ];
    await repos.tank.save(state, tankId);
    await mod.getSync()?.syncNow();
    return { spriteName: sprite.name, spriteId: sprite.id };
  });
  await page.waitForTimeout(1500);

  // ---- the owner's side --------------------------------------------------------------
  await page.getByRole('button', { name: /Build Tank/i }).click();
  await page.waitForTimeout(1500);
  await page.locator('.tank-sidebar-tabs button', { hasText: 'Share' }).click();
  await page.waitForTimeout(1500);

  const panel = await page.locator('.tank-share-panel, .tank-share-hint').first().innerText();
  check('the Share tab opens on a signed-in, backed-up tank', !/Sign in first/i.test(panel), panel.split('\n')[0]);

  const linkButton = page.locator('.tank-share-choices button', { hasText: 'Anyone with the link' });
  check('the panel offers a link, and does not offer a public listing', (await linkButton.count()) === 1 && (await page.getByRole('button', { name: /public/i }).count()) === 0);

  await linkButton.click();
  await page.waitForTimeout(2000);
  const link = await page.locator('.tank-share-link input').first().inputValue();
  check('turning the link on produces one, with a slug in it', /\?tank=.+&k=[0-9a-f]{32}$/.test(link), link.replace(/k=.{8}.*/, 'k=…'));

  const tankId = new URLSearchParams(link.split('?')[1]).get('tank');
  const visibility = await (await fetch(`${SUPA}/rest/v1/tanks?id=eq.${tankId}&select=visibility,share_slug`, {
    headers: { apikey: KEY, Authorization: `Bearer ${token}` },
  })).json();
  check('and the panel actually wrote it to the server', visibility[0]?.visibility === 'unlisted' && !!visibility[0]?.share_slug);

  // ---- the viewer's side -------------------------------------------------------------
  // A brand new browser profile with no session at all - the person who was handed the link.
  const viewer = await browser.newContext();
  const viewerPage = await viewer.newPage();
  viewerPage.on('pageerror', (e) => errors.push('viewer pageerror: ' + e.message));
  viewerPage.setDefaultTimeout(20000);
  await viewerPage.goto(link, { waitUntil: 'domcontentloaded' });
  await viewerPage.waitForSelector('.shared-tank-view');
  await viewerPage.waitForTimeout(3000);

  const bar = await viewerPage.locator('.shared-tank-bar').innerText();
  check('a stranger with the link gets the tank, marked view-only', /View only/i.test(bar), bar.replace(/\n/g, ' | '));
  check('and it is the owner tank, by name', /My Tank/i.test(bar), bar.replace(/\n/g, ' | '));
  // Two separate questions, because they fail separately: did the contents arrive, and did anything
  // get painted with them.
  const arrived = await viewerPage.evaluate(async (id) => {
    const mod = await import('/src/lib/data/sharing.ts');
    const params = new URLSearchParams(window.location.search);
    const tank = await mod.fetchSharedTank(id, params.get('k'));
    return { instances: tank?.state.instances.length ?? 0, sprites: (tank?.sprites ?? []).map((s) => s.name) };
  }, tankId);
  check("the owner's fish came with the tank", arrived.instances === 1 && arrived.sprites.includes(placed.spriteName), JSON.stringify(arrived));

  const painted = await viewerPage.evaluate(() => {
    const canvas = document.querySelector('.shared-tank-view canvas.tank-canvas');
    if (!canvas || !canvas.width) return -1;
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let opaque = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) opaque += 1;
    return opaque;
  });
  check('and the canvas has actually been painted', painted > 1000, `${painted} opaque pixels`);
  check('nothing in the view can save, refresh or resize it', (await viewerPage.locator('.shared-tank-view .tank-action-bar').count()) === 0);
  check('nor edit the tank in any other panel', (await viewerPage.locator('.shared-tank-view .tank-sidebar').count()) === 0);
  // The one thing that must never happen: the viewer's own library quietly acquiring the owner's work.
  const viewerLibrary = await viewerPage.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('fishtank');
        req.onsuccess = () => {
          const all = req.result.transaction('sprites', 'readonly').objectStore('sprites').getAll();
          all.onsuccess = () => resolve(all.result.map((s) => s.name));
        };
        req.onerror = () => resolve(['<no database>']);
      })
  );
  check(
    'the shared tank never lands in the viewer own database',
    !viewerLibrary.includes('Before Sign In'),
    viewerLibrary.join(', ') || '(empty)'
  );

  // ---- turning it back off ------------------------------------------------------------
  await page.locator('.tank-share-choices button', { hasText: 'Only me' }).click();
  await page.waitForTimeout(1500);
  const afterPrivate = await viewerPage.evaluate(async (id) => {
    const mod = await import('/src/lib/data/sharing.ts');
    const params = new URLSearchParams(window.location.search);
    return mod.fetchSharedTank(id, params.get('k'));
  }, tankId);
  check('setting it back to Only me closes the link immediately', afterPrivate === null);

  const realErrors = errors.filter((e) => !/favicon|Failed to load resource/i.test(e));
  check('no unexpected console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' // '));

  for (const table of ['tank_instances', 'tank_groups', 'room_instances', 'tanks', 'sprites']) {
    await fetch(`${SUPA}/rest/v1/${table}?id=neq.__none__`, {
      method: 'DELETE',
      headers: { apikey: KEY, Authorization: `Bearer ${token}` },
    });
  }
  const leftover = await (await fetch(`${SUPA}/rest/v1/sprites?select=id`, {
    headers: { apikey: KEY, Authorization: `Bearer ${token}` },
  })).json();
  check('probe data cleaned off the server', leftover.length === 0, `${leftover.length} rows left`);

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  clearTimeout(killer);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  // A run that fails only because throwaway accounts are switched off is not a bug in the app.
  if (String(e && e.message).includes('ANON_SIGNIN_FAILED')) {
    console.error(`
${ANON_DISABLED_HINT}
`);
    process.exit(4);
  }
  console.error('CRASH', e);
  process.exit(2);
});
