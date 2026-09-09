/**
 * The sync path, end to end, against the real Supabase project (plan P5-5).
 *
 *   npm run dev                  # in another terminal
 *   node scripts/sync-smoke.cjs
 *
 * Needs a .env with a project, and anonymous sign-ins enabled on it (Authentication -> Sign In /
 * Providers). It signs in anonymously - a real account, so RLS and the wire format are exercised for
 * real - which is also why no mailbox is involved. Everything it creates on the server is deleted at
 * the end.
 *
 * Two bugs this caught that no local test could: a delta pull filtered by the client's clock silently
 * skipping records, and a seed-cleanup heuristic deleting sprites that were already uploaded.
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

/** Signs the page's Supabase client in anonymously and waits for the app to notice. */
async function signInAnonymously(page) {
  return page.evaluate(async () => {
    const mod = await import('/src/lib/supabase.ts');
    const supabase = mod.getSupabase();
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) throw new Error(`ANON_SIGNIN_FAILED: ${error.message}`);
    return data.user.id;
  });
}

async function syncNow(page) {
  await page.evaluate(async () => {
    const mod = await import('/src/lib/data/index.ts');
    await mod.getSync()?.syncNow();
  });
}

async function outboxSize(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('fishtank');
        req.onsuccess = () => {
          const all = req.result.transaction('outbox', 'readonly').objectStore('outbox').getAll();
          all.onsuccess = () => resolve(all.result.length);
        };
        req.onerror = () => resolve(-1);
      })
  );
}

async function drawAndSave(page, name) {
  // Start a new sprite *before* drawing - "New" discards whatever is on the canvas.
  // The "new sprite" control is the + tile in the library (title="New"), not a labelled button.
  await page.locator('button.library-add').click();
  await page.waitForTimeout(200);
  const box = await page.locator('canvas.pixel-canvas').boundingBox();
  for (let i = 0; i < 4; i += 1) {
    await page.mouse.move(box.x + 30 + i * 7, box.y + 30 + i * 7);
    await page.mouse.down();
    await page.mouse.move(box.x + 36 + i * 7, box.y + 36 + i * 7);
    await page.mouse.up();
  }
  await page.fill('.status-name-input', name);
  await page.getByRole('button', { name: 'Save to library' }).click();
  await page.waitForTimeout(400);
}

/** Reads the server as a given account, without the app in the way. */
async function serverRows(token, path) {
  const res = await fetch(`${SUPA}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${token}` },
  });
  return res.json();
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  // "New" asks whether to discard the unsaved drawing; Playwright dismisses dialogs by default, which
  // would silently keep editing the same sprite instead of making a second one.
  page.on('dialog', (d) => d.accept());
  page.setDefaultTimeout(20000);

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas.pixel-canvas');

  // ---- 1. work done as a guest, then signed in ------------------------------------
  await drawAndSave(page, 'Before Sign In');
  const userId = await signInAnonymously(page);
  check('signed in to a real account', !!userId, userId?.slice(0, 8));

  const token = await page.evaluate(async () => {
    const mod = await import('/src/lib/supabase.ts');
    const { data } = await mod.getSupabase().auth.getSession();
    return data.session.access_token;
  });

  // The app offers to upload existing work; take it.
  await page.waitForSelector('[role="alertdialog"]', { timeout: 10000 });
  const claimText = await page.locator('[role="alertdialog"]').innerText();
  check('first sign-in offers to upload existing work', /upload/i.test(claimText), claimText.split('\n')[0]);
  await page.getByRole('button', { name: /Upload it/i }).click();
  await page.waitForTimeout(4000);
  // The "uploaded" confirmation is modal; dismiss it before driving the editor again.
  const uploadedDialog = await page.locator('[role="alertdialog"]').count();
  check('the upload reports back when it is done', uploadedDialog === 1);
  await page.getByRole('button', { name: /^OK$/ }).click();
  await page.waitForTimeout(300);

  const sprites = await serverRows(token, 'sprites?select=id,name,rev');
  check('guest work is now on the server', sprites.some((s) => s.name === 'Before Sign In'), `${sprites.length} sprites`);
  check('the default sprites went up too', sprites.length >= 3, JSON.stringify(sprites.map((s) => s.name)));
  const tanks = await serverRows(token, 'tanks?select=id,name');
  check('the tank went up under its own id', tanks.length === 1, JSON.stringify(tanks));


  const drained = await outboxSize(page);
  check('the outbox drained', drained === 0, `outbox=${drained}`);

  // ---- 1b. everything *inside* a tank, not just the tank ----------------------------
  // Sprites and the tank's own row were the only things this script ever watched, and that is exactly
  // how room decor and groups went unnoticed: rows.ts sent a `sprite_id` key for every child, the
  // tank_groups and room_instances tables had no such column, PostgREST rejected the whole request,
  // and the outbox retried it forever. Everything looked fine here because nothing looked.
  //
  // Written through the repository rather than by dragging decor around the tank UI: the point is
  // whether the *sync* path carries these row shapes, and a drag gesture would only make the test
  // fragile without testing anything more.
  const childProbe = await page.evaluate(async () => {
    const mod = await import('/src/lib/data/index.ts');
    const repos = mod.getRepos();
    await repos.sprites.hydrate();
    const spriteId = repos.sprites.list()[0]?.id;
    const tankId = await repos.tank.currentId();
    const state = await repos.tank.load(tankId);
    const now = Date.now();
    state.roomInstances = [
      ...state.roomInstances,
      { id: 'room_probe', spriteId, x: 12, y: 12, visible: true, updatedAt: now, deletedAt: 0, rev: 0 },
    ];
    state.groups = [
      ...state.groups,
      { id: 'grp_probe', name: 'Probe school', zone: null, updatedAt: now, deletedAt: 0, rev: 0 },
    ];
    await repos.tank.save(state, tankId);
    return { tankId, spriteId };
  });
  await syncNow(page);
  await page.waitForTimeout(1500);

  const roomRows = await serverRows(token, `room_instances?tank_id=eq.${childProbe.tankId}&select=id,sprite_id`);
  check('room decor reaches the server, sprite and all', roomRows.some((r) => r.id === 'room_probe' && r.sprite_id === childProbe.spriteId), JSON.stringify(roomRows));
  const groupRows = await serverRows(token, `tank_groups?tank_id=eq.${childProbe.tankId}&select=id`);
  check('so do groups, which have no sprite at all', groupRows.some((r) => r.id === 'grp_probe'), JSON.stringify(groupRows));
  const drainedChildren = await outboxSize(page);
  check('and neither is stuck in the outbox', drainedChildren === 0, `outbox=${drainedChildren}`);

  // ---- 2. edits while offline ------------------------------------------------------
  await ctx.setOffline(true);
  await drawAndSave(page, 'Made Offline');
  const offlineLocal = await page.locator('.library-card').allInnerTexts();
  check('work saves normally while offline', offlineLocal.join(' ').includes('Made Offline'));
  const queuedOffline = await outboxSize(page);
  check('the offline edit is queued', queuedOffline >= 1, `outbox=${queuedOffline}`);

  const serverDuringOffline = await serverRows(token, 'sprites?select=name');
  check('nothing reached the server while offline', !serverDuringOffline.some((s) => s.name === 'Made Offline'));

  // ---- 3. back online ---------------------------------------------------------------
  await ctx.setOffline(false);
  await syncNow(page);
  await page.waitForTimeout(2500);

  const afterReconnect = await serverRows(token, 'sprites?select=id,name');
  check('the offline edit uploads on reconnect', afterReconnect.some((s) => s.name === 'Made Offline'), `${afterReconnect.length} sprites`);
  const ids = afterReconnect.map((s) => s.id);
  check('nothing was duplicated', new Set(ids).size === ids.length, `${ids.length} rows, ${new Set(ids).size} unique`);
  const drainedAgain = await outboxSize(page);
  check('the outbox drained again', drainedAgain === 0, `outbox=${drainedAgain}`);

  // ---- 4. a second device, same account ---------------------------------------------
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  page2.on('pageerror', (e) => errors.push('device2 pageerror: ' + e.message));
  await page2.goto(URL, { waitUntil: 'domcontentloaded' });
  await page2.waitForSelector('canvas.pixel-canvas');
  // Same account, a browser that has never seen this work.
  await page2.evaluate(async (t) => {
    const mod = await import('/src/lib/supabase.ts');
    await mod.getSupabase().auth.setSession({ access_token: t.access, refresh_token: t.refresh });
  }, await page.evaluate(async () => {
    const mod = await import('/src/lib/supabase.ts');
    const { data } = await mod.getSupabase().auth.getSession();
    return { access: data.session.access_token, refresh: data.session.refresh_token };
  }));
  // Decline the "upload this device's work" offer: this device is here to receive, not to push.
  await page2.getByRole('button', { name: /Keep it local/i }).click().catch(() => {});
  await syncNow(page2);
  // No reload: work arriving from another device has to show up live, not next time the tab opens.
  await page2.waitForTimeout(2500);

  const device2Library = await page2.locator('.library-card').allInnerTexts();
  const names = device2Library.map((t) => t.trim());
  const fromAccount = names.filter((n) => n === 'Made Offline' || n === 'Before Sign In');
  check('the account library is not duplicated on the second device', new Set(fromAccount).size === fromAccount.length, names.join(' | '));
  check(
    'a second device receives the work without a reload',
    device2Library.join(' ').includes('Made Offline') && device2Library.join(' ').includes('Before Sign In'),
    device2Library.join(' | ')
  );

  const realErrors = errors.filter((e) => !/favicon|Failed to load resource|net::ERR_INTERNET_DISCONNECTED/i.test(e));
  check('no unexpected console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' // '));

  // ---- cleanup: remove everything these probe accounts created ----------------------
  for (const table of ['tank_instances', 'tank_groups', 'room_instances', 'tanks', 'sprites']) {
    await fetch(`${SUPA}/rest/v1/${table}?id=neq.__none__`, {
      method: 'DELETE',
      headers: { apikey: KEY, Authorization: `Bearer ${token}` },
    });
  }
  const leftover = await serverRows(token, 'sprites?select=id');
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
