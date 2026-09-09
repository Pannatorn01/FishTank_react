/**
 * The tank gallery, driven in a real browser (plan P6-6).
 *
 *   npm run dev                          # in another terminal
 *   node scripts/tank-gallery-ui-smoke.cjs
 *
 * tank-gallery-smoke.cjs checks which tanks the database will list; this checks that the app can
 * actually publish one, find it in the listing, and open it - the round trip a person makes.
 *
 * Needs a .env with a project, anonymous sign-ins enabled on it, and `npm run dev` running.
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
    if (error) throw new Error(error.message);
  });
  const token = await page.evaluate(async () => {
    const mod = await import('/src/lib/supabase.ts');
    const { data } = await mod.getSupabase().auth.getSession();
    return data.session.access_token;
  });

  await page.waitForSelector('[role="alertdialog"]');
  await page.getByRole('button', { name: /Upload it/i }).click();
  await page.waitForTimeout(4000);
  await page.getByRole('button', { name: /^OK$/ }).click();
  await page.waitForTimeout(300);

  // A per-run id, never a fixed one. These records are minted client-side and their id is the primary
  // key, so a fixed id collides with the row a previous run left behind - and because that row belongs
  // to a different (throwaway) account, the upsert is refused by row-level security rather than
  // overwriting it, the outbox retries it forever, and every later run sees an empty tank for reasons
  // nothing on screen explains. Cost three runs to find.
  const probeInstanceId = `inst_gallery_${Date.now()}`;

  // Give the tank a fish, so the card has a count to show and the opened tank has something in it.
  await page.evaluate(async (instanceId) => {
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
        id: instanceId, spriteId: sprite.id, kind: sprite.type, x: 60, y: 60, dir: 1, vx: 10, vy: 2,
        targetY: 60, frameIndex: 0, frameTimer: 0, bobPhase: 0, isDragging: false, swimSpeed: 'medium',
        groupId: null, schoolOffsetY: 0, zone: null, visible: true, bornAt: now, lifespanMs: 9e8,
        dead: false, diedAt: 0, hunger: 1, starvingSince: 0, matureAt: now, wellFedSince: 0,
        updatedAt: now, deletedAt: 0, rev: 0,
      },
    ];
    await repos.tank.save(state, tankId);
    await mod.getSync()?.syncNow();
  }, probeInstanceId);
  await page.waitForTimeout(1500);

  // Before anything is published, so a later "0 fish" on the card can be told apart from a fish that
  // never reached the server in the first place - the two look identical from the listing.
  const tankBefore = await page.evaluate(async () => {
    const mod = await import('/src/lib/data/index.ts');
    return mod.getRepos().tank.currentId();
  });
  const uploaded = await (await fetch(`${SUPA}/rest/v1/tank_instances?tank_id=eq.${tankBefore}&select=id,deleted_at`, {
    headers: { apikey: KEY, Authorization: `Bearer ${token}` },
  })).json();
  check('the fish reached the server before publishing', uploaded.filter((r) => r.deleted_at === 0).length === 1, JSON.stringify(uploaded));

  // ---- publish it -------------------------------------------------------------------
  await page.getByRole('button', { name: /Build Tank/i }).click();
  await page.waitForTimeout(1500);
  await page.locator('.tank-sidebar-tabs button', { hasText: 'Share' }).click();
  await page.waitForTimeout(1500);

  const choices = await page.locator('.tank-share-choices button').allInnerTexts();
  check('the panel now offers a public choice as well', choices.some((c) => /Anyone$/i.test(c.trim())), choices.join(' | '));

  // Matched on text content, not on the accessible name. Every button here starts with a Font Awesome
  // <i>, whose glyph is CSS ::before content that Playwright folds into the accessible name - so
  // `getByRole(name: 'Anyone', exact: true)` never matches, while a loose "Anyone" would also match
  // "Anyone with the link", which is the wrong button and the whole point of this step.
  await page.locator('.tank-share-choices button', { hasText: /^\s*Anyone\s*$/ }).click();
  await page.waitForTimeout(2000);

  const tankId = await page.evaluate(async () => {
    const mod = await import('/src/lib/data/index.ts');
    return mod.getRepos().tank.currentId();
  });
  const row = await (await fetch(`${SUPA}/rest/v1/tanks?id=eq.${tankId}&select=visibility`, {
    headers: { apikey: KEY, Authorization: `Bearer ${token}` },
  })).json();
  check('publishing writes it to the server', row[0]?.visibility === 'public', JSON.stringify(row[0]));

  // ---- find it in the listing ---------------------------------------------------------
  await page.getByRole('button', { name: /Browse public tanks/i }).click();
  await page.waitForSelector('.tank-gallery-list, .gallery-hint');
  await page.waitForTimeout(1500);

  const rows = await page.locator('.tank-gallery-row').allInnerTexts();
  check('the published tank appears in the listing', rows.some((r) => /My Tank/i.test(r)), rows.slice(0, 3).join(' | '));
  // `\d+ fish` is not good enough: the first version of this check said PASS on a card reading
  // "0 fish", which was the visible symptom of a real bug (a save resolving before it had queued -
  // see SpriteRepo.onWrite). The count has to be the count.
  check(
    'and its card counts the fish that were put in it',
    rows.some((r) => /\b1 fish\b/i.test(r)),
    rows.slice(0, 3).join(' | ').replace(/\n/g, ' ')
  );

  // ---- open it from the listing --------------------------------------------------------
  await page.locator('.tank-gallery-row', { hasText: 'My Tank' }).first().getByRole('button', { name: /Open/i }).click();
  await page.waitForSelector('.shared-tank-view');
  await page.waitForTimeout(3000);

  const bar = await page.locator('.shared-tank-bar').innerText();
  check('opening from the listing lands in the read-only view', /View only/i.test(bar), bar.replace(/\n/g, ' | '));
  check('with a report button, since it is now public', (await page.locator('.shared-tank-bar .gallery-report').count()) === 1);
  check('and no editing chrome at all', (await page.locator('.shared-tank-view .tank-action-bar').count()) === 0);

  const realErrors = errors.filter((e) => !/favicon|Failed to load resource/i.test(e));
  check('no unexpected console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' // '));

  for (const table of ['tank_instances', 'tank_groups', 'room_instances', 'tanks', 'sprites']) {
    await fetch(`${SUPA}/rest/v1/${table}?id=neq.__none__`, {
      method: 'DELETE',
      headers: { apikey: KEY, Authorization: `Bearer ${token}` },
    });
  }
  const leftover = await (await fetch(`${SUPA}/rest/v1/tanks?select=id`, {
    headers: { apikey: KEY, Authorization: `Bearer ${token}` },
  })).json();
  check('probe data cleaned off the server', leftover.length === 0, `${leftover.length} rows left`);

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  clearTimeout(killer);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('CRASH', e);
  process.exit(2);
});
