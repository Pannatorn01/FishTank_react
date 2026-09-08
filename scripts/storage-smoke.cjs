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

  const encodedOnBootstrap = await page.evaluate(() =>
    (localStorage.getItem('fishtank.sprites.v1') || '').includes('"enc":"rle1"')
  );
  check('bootstrap wrote frames run-length encoded', encodedOnBootstrap);

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

  const afterSave = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('fishtank.sprites.v1'));
    return {
      count: raw.length,
      names: raw.map((s) => s.name),
      hasMeta: raw.every((s) => typeof s.updatedAt === 'number' && s.deletedAt === 0 && s.rev === 0),
      allHaveIds: raw.every((s) => typeof s.id === 'string' && s.id.length > 0),
      encoded: raw.every((s) => s.frames.every((f) => f.every((l) => l.cells && l.cells.enc === 'rle1'))),
      bytes: localStorage.getItem('fishtank.sprites.v1').length,
    };
  });
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
  const afterDelete = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('fishtank.sprites.v1'));
    const dead = raw.filter((s) => s.deletedAt > 0);
    return {
      live: raw.filter((s) => s.deletedAt === 0).map((s) => s.name),
      tombstones: dead.map((s) => ({ name: s.name, frames: s.frames.length })),
    };
  });
  check('deleted sprite leaves a tombstone with no frames',
    afterDelete.tombstones.length === 1 && afterDelete.tombstones[0].frames === 0,
    JSON.stringify(afterDelete.tombstones));
  const cardsAfterDelete = await page.locator('.library-card').count();
  check('deleted sprite is gone from the library UI', cardsAfterDelete === 2, `cards=${cardsAfterDelete}`);

  // ---- 5. a library saved in the OLD uncompressed format still loads -----------------
  await page.evaluate(() => {
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
  check('a pre-RLE library still loads', legacyNames.join(' ').includes('Legacy Fish'), legacyNames.join(' | '));

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
    const tankSaved = await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('fishtank.instances.v1') || '[]');
      return { n: raw.length, meta: raw.every((i) => typeof i.updatedAt === 'number' && i.deletedAt === 0) };
    });
    check('tank save writes an instance', tankSaved.n >= 1, `instances=${tankSaved.n}`);
    check('tank instances carry RecordMeta', tankSaved.meta);
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

  // ---- 8. the warning banner appears as the store fills ------------------------------
  const page3 = await ctx.newPage();
  await page3.goto(URL, { waitUntil: 'domcontentloaded' });
  await page3.evaluate(() => {
    // ~4MB of junk under a key the app owns, i.e. ~80% of the assumed 5MB budget.
    localStorage.setItem('fishtank.paletteColors.v1', JSON.stringify('x'.repeat(2_000_000)));
  });
  await page3.reload({ waitUntil: 'domcontentloaded' });
  await page3.waitForSelector('canvas.pixel-canvas');
  const warnBanner = await page3.locator('.storage-banner').first().innerText().catch(() => '');
  check('warning banner appears when the store is ~80% full', warnBanner.includes('% full'), JSON.stringify(warnBanner));

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
