// Checks the auth/guest wiring in the running app. No email is actually sent: the magic-link request
// is intercepted so the test can assert what the app asks for, not what Supabase does with it.
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

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.setDefaultTimeout(15000);

  const otpRequests = [];
  await page.route('**/auth/v1/otp*', async (route) => {
    otpRequests.push(JSON.parse(route.request().postData() || '{}'));
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas.pixel-canvas');

  // Guest mode: the app is fully usable, and nothing demands an account.
  const cards = await page.locator('.library-card').count();
  // Not a fixed count - how many sprites ship with the app is a product decision (see the same note in
  // storage-smoke.cjs). What guest mode promises is a usable app with something already in it, before
  // anyone is asked for an account.
  check('guest can use the app immediately', cards > 0, `sprites=${cards}`);
  const dialogs = await page.locator('[role="alertdialog"]').count();
  check('no sign-in wall on load', dialogs === 0);

  const signIn = page.getByRole('button', { name: /Back up my work/i });
  check('a sign-in offer is visible', (await signIn.count()) === 1);

  const chip = await page.locator('.sync-chip').count();
  check('sync chip is hidden while signed out with nothing queued', chip === 0, `chips=${chip}`);

  // The sign-in flow itself.
  await signIn.click();
  await page.waitForSelector('[role="alertdialog"]');
  await page.locator('input[type="email"]').fill('tester@example.com');
  await page.getByRole('button', { name: /Send link/i }).click();
  await page.waitForTimeout(800);
  check('requests a magic link for the address given', otpRequests.length === 1 && otpRequests[0].email === 'tester@example.com', JSON.stringify(otpRequests));
  const confirmText = await page.locator('[role="alertdialog"]').innerText();
  check('tells the user to check their email', /tester@example\.com/.test(confirmText), confirmText.split('\n')[0]);

  // Work done as a guest still saves locally while signed out.
  await page.getByRole('button', { name: /OK/i }).click();
  await page.waitForTimeout(300);
  await page.fill('.status-name-input', 'Guest Fish');
  await page.getByRole('button', { name: 'Save to library' }).click();
  await page.waitForTimeout(500);
  const afterSave = await page.locator('.library-card').allInnerTexts();
  check('a guest can still save work', afterSave.join(' ').includes('Guest Fish'), afterSave.join(' | '));

  const pending = await page.evaluate(
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
  // Queued, not lost: a guest's edits are waiting for an account rather than being dropped.
  check('guest edits are queued for a future account', pending >= 1, `outbox=${pending}`);

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
