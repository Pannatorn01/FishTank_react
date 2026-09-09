/**
 * The gallery as the app presents it (plan P6-4/P6-5), with the server stubbed.
 *
 *   npm run dev                       # in another terminal
 *   node scripts/gallery-ui-smoke.cjs
 *
 * The listing call is intercepted and answered with fixtures, so this runs against any project (or a
 * project whose schema has not been updated yet) and never publishes or reports anything real. What it
 * checks is the half that scripts/gallery-smoke.cjs cannot: that the app asks for the right things,
 * that copying a sprite really lands in the local library, and - the point of the whole feature pair -
 * that the report control is there and is honest about needing an account.
 */
const { chromium } = require('playwright');

const URL = 'http://localhost:5173/';
const killer = setTimeout(() => {
  console.error('HARD TIMEOUT');
  process.exit(3);
}, 120000);
killer.unref?.();

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  :: ' + detail : ''}`);
}

/** Two published sprites, in the shape gallery_sprites() returns. */
const FIXTURES = [
  {
    id: 'gallery_sprite_1',
    name: 'Stub Angelfish',
    type: 'fish',
    width: 2,
    height: 2,
    frame_ms: 120,
    frames: [[{ id: 'l1', name: 'Layer 1', visible: true, opacity: 1, cells: ['#ff7043', null, null, '#1a1a1a'] }]],
    forked_from: null,
    server_updated_at: '2026-09-09T00:00:00Z',
  },
  {
    id: 'gallery_sprite_2',
    name: 'Stub Kelp',
    type: 'object',
    width: 2,
    height: 2,
    frame_ms: 120,
    frames: [[{ id: 'l1', name: 'Layer 1', visible: true, opacity: 1, cells: [null, '#4ade80', '#4ade80', null] }]],
    forked_from: null,
    server_updated_at: '2026-09-08T00:00:00Z',
  },
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('dialog', (d) => d.accept());
  page.setDefaultTimeout(15000);

  const galleryCalls = [];
  await page.route('**/rest/v1/rpc/gallery_sprites', async (route) => {
    galleryCalls.push(JSON.parse(route.request().postData() || '{}'));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FIXTURES) });
  });

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas.pixel-canvas');

  const before = await page.locator('.library-card').count();

  // ---- opening it ------------------------------------------------------------------
  const openButton = page.getByRole('button', { name: /Gallery/i });
  check('the gallery is reachable from the library', (await openButton.count()) === 1);
  await openButton.click();
  await page.waitForSelector('.gallery-card');

  const names = (await page.locator('.gallery-name').allInnerTexts()).map((s) => s.trim());
  check('published sprites are listed', names.includes('Stub Angelfish') && names.includes('Stub Kelp'), names.join(' | '));
  check('the listing asks for one page, newest first', galleryCalls.length === 1 && galleryCalls[0].lim === 60, JSON.stringify(galleryCalls));

  const thumbs = await page.locator('.gallery-card canvas').count();
  check('each entry draws its sprite', thumbs === 2, `${thumbs} thumbnails`);

  // ---- signed out: browsing yes, writing no -----------------------------------------
  const copyDisabled = await page.locator('.gallery-card').first().getByRole('button', { name: /Add to my library/i }).isDisabled();
  check('copying is offered but disabled without an account', copyDisabled);
  const reportButton = page.locator('.gallery-report').first();
  check('every entry carries a report control', (await page.locator('.gallery-report').count()) === 2);
  check('reporting is disabled without an account', await reportButton.isDisabled());
  const reportTitle = await reportButton.getAttribute('title');
  check('the report control says why it is disabled', /sign in/i.test(reportTitle || ''), reportTitle);

  // ---- the publish control belongs to signed-in users only ---------------------------
  await page.getByRole('button', { name: /Close/i }).click();
  await page.waitForTimeout(200);
  const publishToggles = await page.locator('.library-publish').count();
  check('no publish toggle appears while signed out', publishToggles === 0, `${publishToggles} toggles`);

  // ---- copying, with the write path stubbed only at the network edge -----------------
  // Copying writes to the local database, which needs no server at all - so this part is real.
  await page.evaluate(async () => {
    const mod = await import('/src/lib/data/gallery.ts');
    await mod.forkGallerySprite({
      sprite: {
        id: 'gallery_sprite_1',
        name: 'Stub Angelfish',
        type: 'fish',
        width: 2,
        height: 2,
        frameMs: 120,
        frames: [[{ id: 'l1', name: 'Layer 1', visible: true, opacity: 1, cells: ['#ff7043', null, null, '#1a1a1a'] }]],
        updatedAt: 0,
        deletedAt: 0,
        rev: 0,
        visibility: 'public',
        forkedFrom: null,
      },
      cursor: '2026-09-09T00:00:00Z',
    });
  });
  await page.waitForTimeout(600);

  const after = await page.locator('.library-card').allInnerTexts();
  check('a copied sprite lands in the library', after.length === before + 1 && after.join(' ').includes('Stub Angelfish'), after.map((s) => s.trim()).join(' | '));

  const stored = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('fishtank');
        req.onsuccess = () => {
          const all = req.result.transaction('sprites', 'readonly').objectStore('sprites').getAll();
          all.onsuccess = () =>
            resolve(all.result.filter((s) => s.name === 'Stub Angelfish').map((s) => ({ id: s.id, from: s.forkedFrom, vis: s.visibility })));
        };
        req.onerror = () => resolve([]);
      })
  );
  check('the copy is a new sprite, not the original', stored.length === 1 && stored[0].id !== 'gallery_sprite_1', JSON.stringify(stored));
  check('the copy records what it was copied from', stored[0]?.from === 'gallery_sprite_1', JSON.stringify(stored));
  check('the copy is private, whatever the original was', stored[0]?.vis === 'private', JSON.stringify(stored));

  const realErrors = errors.filter((e) => !/favicon|Failed to load resource/i.test(e));
  check('no unexpected console errors', realErrors.length === 0, realErrors.slice(0, 2).join(' // '));

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  clearTimeout(killer);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('CRASH', e);
  process.exit(2);
});
