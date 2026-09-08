/**
 * End-to-end smoke test for the storage layer (docs/STORAGE_DB_MIGRATION_PLAN.md P0-P2), driven through
 * the real UI in a real browser - unit tests cover the encoding and the migrations, this covers the
 * wiring: what the app actually writes, what survives a reload, and what the user is told when a write
 * fails.
 *
 *   npm run dev                 # in another terminal
 *   node scripts/storage-smoke.cjs
 *
 * Needs playwright available to node (npx playwright is enough; point NODE_PATH at its node_modules if
 * it is not installed locally). Everything runs under one hard timeout: a hung browser must fail the
 * run, not sit there forever.
 */
const { chromium } = require('playwright');

const URL = process.env.APP_URL || 'http://localhost:5173/';
const HARD_TIMEOUT_MS = 120000;
const killer = setTimeout(() => {
  console.error('HARD TIMEOUT - killing');
  process.exit(3);
}, HARD_TIMEOUT_MS);
killer.unref?.();


/** Reads an object store out of the app's IndexedDB database, from inside the page. */
async function readStore(page, store) {
  return page.evaluate(
    (name) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('fishtank');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const all = db.transaction(name, 'readonly').objectStore(name).getAll();
          all.onsuccess = () => resolve(all.result);
          all.onerror = () => reject(all.error);
        };
      }),
    store
  );
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  :: ' + detail : ''}`);
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.setDefaultTimeout(15000);

  // ---- 1. cold start, empty storage -------------------------------------------------
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas.pixel-canvas');
  const libCards = await page.locator('.library-card').count();
  check('cold start shows the two default sprites', libCards === 2, `cards=${libCards}`);

  const bootstrapRows = await readStore(page, 'sprites');
  check(
    'bootstrap wrote frames run-length encoded into IndexedDB',
    bootstrapRows.length === 2 && bootstrapRows.every((s) => s.frames.every((f) => f.every((l) => l.cells.enc === 'rle1'))),
    `rows=${bootstrapRows.length}`
  );

  const metaRows = await readStore(page, 'meta');
  const meta = Object.fromEntries(metaRows.map((m) => [m.key, m.value]));
  check('a tank id and a local user id exist from the first run', !!meta.currentTankId && !!meta.localUserId, JSON.stringify(meta));

  const bannerCount = await page.locator('.storage-banner').count();
  check('no storage warning banner on a nearly empty store', bannerCount === 0);

  // ---- 2. draw + save through the UI ------------------------------------------------
  const canvas = page.locator('canvas.pixel-canvas');
  const box = await canvas.boundingBox();
  for (let i = 0; i < 6; i += 1) {
    await page.mouse.move(box.x + 30 + i * 6, box.y + 30 + i * 6);
    await page.mouse.down();
    await page.mouse.move(box.x + 34 + i * 6, box.y + 34 + i * 6);
    await page.mouse.up();
  }
  await page.fill('.status-name-input', 'Smoke Fish');
  await page.getByRole('button', { name: 'Save to library' }).click();
  await page.waitForTimeout(300);

  const rows = await readStore(page, 'sprites');
  const afterSave = {
    count: rows.length,
    names: rows.map((s) => s.name),
    hasMeta: rows.every((s) => typeof s.updatedAt === 'number' && s.deletedAt === 0 && s.rev === 0),
    allHaveIds: rows.every((s) => typeof s.id === 'string' && s.id.length > 0),
    encoded: rows.every((s) => s.frames.every((f) => f.every((l) => l.cells && l.cells.enc === 'rle1'))),
    bytes: JSON.stringify(rows).length,
  };
  check('saving adds the sprite to the library', afterSave.count === 3 && afterSave.names.includes('Smoke Fish'), JSON.stringify(afterSave.names));
  check('every saved record carries RecordMeta', afterSave.hasMeta);
  check('every saved record has an id', afterSave.allHaveIds);
  check('every saved frame is encoded', afterSave.encoded);
  check('3 sprites still cost well under 20KB', afterSave.bytes < 20000, `${afterSave.bytes} chars`);

  // ---- 3. reload: does the drawing survive? -----------------------------------------
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas.pixel-canvas');
  const namesAfterReload = await page.locator('.library-card').allInnerTexts();
  check('saved sprite survives a reload', namesAfterReload.join(' ').includes('Smoke Fish'), namesAfterReload.join(' | '));

  // ---- 4. delete leaves a tombstone -------------------------------------------------
  page.once('dialog', (d) => d.accept());
  const cardWithSmoke = page.locator('.library-card', { hasText: 'Smoke Fish' });
  await cardWithSmoke.locator('button').last().click();
  await page.waitForTimeout(300);
  const deleteRows = await readStore(page, 'sprites');
  const afterDelete = {
    live: deleteRows.filter((s) => s.deletedAt === 0).map((s) => s.name),
    tombstones: deleteRows.filter((s) => s.deletedAt > 0).map((s) => ({ name: s.name, frames: s.frames.length })),
  };
  check('deleted sprite leaves a tombstone with no frames',
    afterDelete.tombstones.length === 1 && afterDelete.tombstones[0].frames === 0,
    JSON.stringify(afterDelete.tombstones));
  const cardsAfterDelete = await page.locator('.library-card').count();
  check('deleted sprite is gone from the library UI', cardsAfterDelete === 2, `cards=${cardsAfterDelete}`);

  // ---- 5. a library saved in the OLD uncompressed format still loads -----------------
  await page.evaluate(() => {
    // Wiping the database puts this browser back in the state a returning user is in: data in
    // localStorage, nothing in IndexedDB yet. Reloading must migrate it across.
    indexedDB.deleteDatabase('fishtank');
    const legacy = [
      {
        id: 'legacy_1',
        name: 'Legacy Fish',
        type: 'fish',
        width: 2,
        height: 2,
        frameMs: 120,
        frames: [[{ id: 'l1', name: 'Layer 1', visible: true, opacity: 1, cells: ['#ffffff', null, null, '#000000'] }]],
      },
    ];
    localStorage.setItem('fishtank.sprites.v1', JSON.stringify(legacy));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas.pixel-canvas');
  const legacyNames = await page.locator('.library-card').allInnerTexts();
  check('a pre-RLE localStorage library is migrated into IndexedDB', legacyNames.join(' ').includes('Legacy Fish'), legacyNames.join(' | '));

  const migratedRows = await readStore(page, 'sprites');
  check('the migrated sprite is in IndexedDB, encoded', migratedRows.length === 1 && migratedRows[0].frames[0][0].cells.enc === 'rle1', `rows=${migratedRows.length}`);
  const localStorageKept = await page.evaluate(() => !!localStorage.getItem('fishtank.sprites.v1'));
  check('migration leaves the localStorage copy in place (the way back)', localStorageKept);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas.pixel-canvas');
  const afterSecondLoad = await readStore(page, 'sprites');
  check('a second load does not migrate again', afterSecondLoad.length === 1, `rows=${afterSecondLoad.length}`);

  // ---- 6. tank: place a fish, save, reload ------------------------------------------
  await page.getByRole('button', { name: 'Build Tank' }).first().click();
  await page.waitForSelector('.tank-sidebar-tabs', { timeout: 20000 });
  await page.getByRole('button', { name: /Sprites/i }).first().click();
  await page.waitForSelector('.tank-palette-item', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(500);
  const tankTab = await page.locator('.tank-palette-item').count();
  if (tankTab > 0) {
    const item = page.locator('.tank-palette-item').first();
    const tankCanvas = page.locator('canvas.tank-canvas').first();
    const ib = await item.boundingBox();
    const tb = await tankCanvas.boundingBox();
    await page.mouse.move(ib.x + ib.width / 2, ib.y + ib.height / 2);
    await page.mouse.down();
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    await page.locator('[title="Save tank"]').first().click();
    await page.waitForTimeout(300);
    const tanks = await readStore(page, 'tanks');
    const instances = tanks.flatMap((t) => t.instances);
    const tankSaved = {
      n: instances.length,
      meta: instances.every((i) => typeof i.updatedAt === 'number' && i.deletedAt === 0),
      named: tanks.every((t) => typeof t.id === 'string' && t.id.length > 0),
    };
    check('tank save writes an instance', tankSaved.n >= 1, `instances=${tankSaved.n}`);
    check('tank instances carry RecordMeta', tankSaved.meta);
    check('the tank is stored under its own id', tankSaved.named);
  } else {
    check('tank palette reachable', false, 'no .tank-palette-item found');
  }

  // ---- 7. quota failure is reported, not silent -------------------------------------
  // A fresh context: an empty store, so the app hits its first-run bootstrap write - the one path that
  // can detect "nothing can be saved at all this session" and flip the editor to read-only.
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  const dialogs = [];
  page2.on('dialog', (d) => {
    dialogs.push(d.message());
    d.accept();
  });
  await page2.addInitScript(() => {
    // Both backends refuse to write: IndexedDB will not open (so the adapter falls back), and the
    // localStorage it falls back to reports itself full. That is the genuinely unwritable browser.
    indexedDB.open = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    const realSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (String(k).startsWith('fishtank.sprites')) throw new DOMException('full', 'QuotaExceededError');
      return realSet.call(this, k, v);
    };
  });
  await page2.goto(URL, { waitUntil: 'domcontentloaded' });
  await page2.waitForSelector('canvas.pixel-canvas', { timeout: 15000 });
  check('app still starts when sprite writes always fail', true);
  await page2.fill('.status-name-input', 'Doomed');
  await page2.getByRole('button', { name: 'Save to library' }).click();
  await page2.waitForTimeout(500);
  check('a failed save tells the user', dialogs.length > 0, JSON.stringify(dialogs));

  const readOnlyBanner = await page2.locator('.storage-banner.storage-banner-error').count();
  check('read-only session shows the red banner', readOnlyBanner === 1, `banners=${readOnlyBanner}`);

  // ---- 8. the warning banner appears as storage fills --------------------------------
  // Reported rather than actually filled: with the data in IndexedDB the real quota is gigabytes, and
  // what is being checked here is that the banner reacts to the browser's own estimate at all.
  const page3 = await ctx.newPage();
  await page3.addInitScript(() => {
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { estimate: async () => ({ usage: 85, quota: 100 }) },
    });
  });
  await page3.goto(URL, { waitUntil: 'domcontentloaded' });
  await page3.waitForSelector('canvas.pixel-canvas');
  await page3.waitForTimeout(500);
  const warnBanner = await page3.locator('.storage-banner').first().innerText().catch(() => '');
  check('warning banner appears when the browser reports storage nearly full', warnBanner.includes('% full'), JSON.stringify(warnBanner));

  // ---- 9. the escape hatch still sees the data now that it lives in IndexedDB -------
  const page4 = await ctx.newPage();
  await page4.goto(URL, { waitUntil: 'domcontentloaded' });
  await page4.waitForSelector('canvas.pixel-canvas');
  const backup = await page4.evaluate(async () => {
    const mod = await import('/src/lib/data/backup.ts');
    const dump = await mod.collectBackup();
    return { stores: Object.keys(dump), sprites: (dump.sprites || []).length };
  });
  check('a backup includes the IndexedDB sprite library', backup.sprites > 0, JSON.stringify(backup));

  const realErrors = errors.filter((e) => !/favicon|font|Failed to load resource/i.test(e));
  check('no unexpected console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' // '));

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  clearTimeout(killer);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('CRASH', e);
  process.exit(2);
});
