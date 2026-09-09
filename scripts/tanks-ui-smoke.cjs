/**
 * Several tanks in one browser (plan P4-4), driven through the running app.
 *
 *   npm run dev                     # in another terminal
 *   node scripts/tanks-ui-smoke.cjs
 *
 * Entirely local: tanks live in IndexedDB, so this needs no Supabase project, no account, and no
 * anonymous sign-ins. What it checks is that each tank really is its own tank - that fish put in one
 * do not appear in another, that switching away from unsaved work asks first, and that the library of
 * sprites stays shared across all of them.
 */
const { chromium } = require('playwright');

const URL = 'http://localhost:5173/';
const killer = setTimeout(() => {
  console.error('HARD TIMEOUT');
  process.exit(3);
}, 150000);
killer.unref?.();

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  :: ' + detail : ''}`);
}

async function openBuildTank(page) {
  await page.getByRole('button', { name: 'Build Tank' }).first().click();
  await page.waitForSelector('.tank-switcher', { timeout: 20000 });
}

/** Drags the first sprite from the palette into the tank. */
async function addFish(page) {
  await page.getByRole('button', { name: /Sprites/i }).first().click();
  await page.waitForSelector('.tank-palette-item');
  const item = page.locator('.tank-palette-item').first();
  const canvas = page.locator('canvas.tank-canvas').first();
  const ib = await item.boundingBox();
  const tb = await canvas.boundingBox();
  await page.mouse.move(ib.x + ib.width / 2, ib.y + ib.height / 2);
  await page.mouse.down();
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

async function tankRows(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('fishtank');
        req.onsuccess = () => {
          const all = req.result.transaction('tanks', 'readonly').objectStore('tanks').getAll();
          all.onsuccess = () => resolve(all.result.map((t) => ({ id: t.id, name: t.name, fish: (t.instances || []).length })));
        };
        req.onerror = () => resolve([]);
      })
  );
}

async function currentTankId(page) {
  return page.evaluate(async () => {
    const mod = await import('/src/lib/data/index.ts');
    return mod.getRepos().tank.currentId();
  });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.setDefaultTimeout(20000);
  const prompts = [];
  page.on('dialog', (d) => {
    prompts.push(d.message());
    d.accept();
  });

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas.pixel-canvas');
  await openBuildTank(page);

  const firstId = await currentTankId(page);
  check('a browser starts with one tank', (await tankRows(page)).length >= 1, JSON.stringify(await tankRows(page)));
  check('deleting is refused while it is the only tank', await page.locator('[title*="at least one tank"]').isDisabled());

  // ---- fish in tank one, saved --------------------------------------------------------
  await addFish(page);
  await page.locator('[title="Save tank"]').first().click();
  await page.waitForTimeout(800);
  const afterSave = await tankRows(page);
  check('a fish saves into the open tank', afterSave.find((t) => t.id === firstId)?.fish === 1, JSON.stringify(afterSave));

  // ---- a second tank ------------------------------------------------------------------
  await page.locator('[title="New tank"]').click();
  await page.waitForTimeout(1200);
  const secondId = await currentTankId(page);
  check('a new tank is created and opened', secondId !== firstId, `${firstId} -> ${secondId}`);
  const two = await tankRows(page);
  check('both tanks exist in storage', two.length === 2, JSON.stringify(two));
  check('the new tank is empty', two.find((t) => t.id === secondId)?.fish === 0, JSON.stringify(two));

  const emptyLayers = await page.locator('.tank-layer-row').count();
  check('the new tank shows empty on screen, not the old one', emptyLayers === 0, `${emptyLayers} rows`);

  // The sprite library is shared - a new tank does not mean a new set of drawings.
  await page.getByRole('button', { name: /Sprites/i }).first().click();
  const paletteItems = await page.locator('.tank-palette-item').count();
  check('the sprite library is shared across tanks', paletteItems >= 2, `${paletteItems} sprites`);

  // ---- renaming ------------------------------------------------------------------------
  await page.locator('[title="Rename this tank"]').click();
  await page.locator('.tank-switcher-input').fill('Reef tank');
  await page.getByRole('button', { name: /^Rename$/ }).click();
  await page.waitForTimeout(800);
  const renamed = await tankRows(page);
  check('a tank can be renamed', renamed.find((t) => t.id === secondId)?.name === 'Reef tank', JSON.stringify(renamed));

  // ---- switching back, with unsaved work in the way -------------------------------------
  await addFish(page);
  prompts.length = 0;
  await page.locator('.tank-switcher-trigger').click();
  await page.getByRole('option').first().click();
  await page.waitForTimeout(1200);
  check('switching away from unsaved work asks first', prompts.some((m) => /unsaved/i.test(m)), JSON.stringify(prompts));

  const backId = await currentTankId(page);
  check('switching lands on the other tank', backId === firstId, `${backId}`);
  // Back to the Layers tab: adding a fish left the sidebar on Sprites, where there are no layer rows
  // to count whatever the tank holds.
  await page.getByRole('button', { name: /Layers/i }).first().click();
  await page.waitForTimeout(300);
  const layersBack = await page.locator('.tank-layer-row').count();
  check('the first tank still has its own fish', layersBack === 1, `${layersBack} rows`);

  // The unsaved fish in the second tank was discarded, as the prompt said it would be.
  const afterSwitch = await tankRows(page);
  check('the discarded fish was never written to the other tank', afterSwitch.find((t) => t.id === secondId)?.fish === 0, JSON.stringify(afterSwitch));

  // ---- it survives a reload -------------------------------------------------------------
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas.pixel-canvas');
  await openBuildTank(page);
  check('the open tank is remembered across a reload', (await currentTankId(page)) === firstId);
  const namesAfterReload = (await tankRows(page)).map((t) => t.name);
  check('both tanks survive a reload', namesAfterReload.includes('Reef tank') && namesAfterReload.length === 2, namesAfterReload.join(' | '));

  // ---- deleting -------------------------------------------------------------------------
  prompts.length = 0;
  await page.locator('[title="Delete this tank"]').click();
  await page.waitForTimeout(1200);
  check('deleting asks first, and names what it is deleting', prompts.some((m) => /delete/i.test(m)), JSON.stringify(prompts));
  const afterDelete = await tankRows(page);
  check('the tank is gone', afterDelete.length === 1 && afterDelete[0].id === secondId, JSON.stringify(afterDelete));
  check('the app moved to the surviving tank', (await currentTankId(page)) === secondId);

  const spritesIntact = await page.evaluate(async () => {
    const mod = await import('/src/lib/data/index.ts');
    await mod.getRepos().sprites.hydrate();
    return mod.getRepos().sprites.list().length;
  });
  check('deleting a tank leaves the sprite library alone', spritesIntact >= 2, `${spritesIntact} sprites`);

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
