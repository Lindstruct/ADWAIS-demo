import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium, firefox } from 'playwright';

const base = new URL(process.env.DEMO_URL ?? 'http://127.0.0.1:4174');
const engine = process.env.DEMO_BROWSER === 'firefox' ? firefox : chromium;
const browser = await engine.launch({ executablePath: process.env.DEMO_BROWSER_BINARY });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
const errors = [];
const requests = [];
const servedAssets = new Set();
const publicFiles = new Set(['/openapi/v1.json', '/swagger/v1/swagger.json', '/api/intranet/calendar/feed.ics', '/health/live', '/health/ready', '/favicon.svg', '/icons.svg']);
const north = '00000000-0000-4000-8000-000000000001';
const tenant = '00000000-0000-4000-8000-000000000004';
const viewer = '00000000-0000-4000-8000-000000000005';
const trace = process.env.DEMO_TRACE;

if (trace) await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
await context.route('**/*', route => {
  const request = route.request();
  const url = new URL(request.url());
  const allowed = url.origin === base.origin && request.method() === 'GET' && (
    (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/fonts/')) || publicFiles.has(url.pathname) ||
    (request.isNavigationRequest() && !url.pathname.startsWith('/api/'))
  );
  requests.push({ method: request.method(), url: url.href, allowed });
  if (allowed) return route.continue();
  errors.push(`Unexpected network request: ${request.method()} ${url.href}`);
  return route.abort();
});
context.on('page', page => {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('response', response => {
    const url = new URL(response.url());
    if (response.status() >= 400) errors.push(`${response.status()} ${url.pathname}`);
    if (url.pathname.startsWith('/assets/') && response.ok()) servedAssets.add(url.pathname);
  });
});

const page = await context.newPage();
page.setDefaultTimeout(8000);
const url = path => new URL(path, base).href;
const visit = async (path, text) => {
  await page.goto(url(path));
  await page.getByText(text, { exact: true }).first().waitFor();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
};
const pickOrg = async label => {
  const picker = page.getByLabel('Active organization').first();
  if (await picker.evaluate(element => element.tagName) === 'SELECT') await picker.selectOption({ label });
  else {
    await picker.click();
    await page.getByRole('option', { name: label, exact: true }).click();
  }
};

try {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded-old-demo-session')) {
      localStorage.setItem('kiosk_token', 'old-homelab-token');
      sessionStorage.setItem('adwais.selectedOrgId', 'old-homelab-org');
      sessionStorage.setItem('seeded-old-demo-session', '1');
    }
  });
  await visit('/', 'Transaction Volume');
  assert.equal(new URL(page.url()).pathname, '/financial');
  await visit('/fleet-status', 'Current fleet');
  await visit('/intranet', 'Company Calendar');
  await page.getByRole('button', { name: 'Calendar settings' }).click();
  await page.getByRole('button', { name: 'Generate Feed Link' }).click();
  await page.getByRole('button', { name: 'Download current events' }).waitFor();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download current events' }).click();
  const download = await downloading;
  assert.match(await readFile(await download.path(), 'utf8'), /BEGIN:VEVENT\r\n/);

  await visit('/settings/platform', 'Open Hangfire Dashboard');
  await page.getByRole('button', { name: 'Add organization' }).click();
  await page.getByLabel('New organization name').fill('Browser test organization');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('cell', { name: 'Browser test organization', exact: true }).waitFor();
  await page.reload();
  await page.getByRole('cell', { name: 'Browser test organization', exact: true }).waitFor();
  const newTab = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Open Hangfire Dashboard' }).click();
  const dashboard = await newTab;
  await dashboard.getByRole('heading', { name: 'Demo job dashboard' }).waitFor();
  await dashboard.close();

  await pickOrg('Northstar Commerce');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('adwais.selectedOrgId')), north);
  await visit('/settings/configuration', 'External Calendar Subscriptions');
  await visit('/settings/tenants', 'Fjord Supply');
  await visit(`/settings/tenants/${tenant}`, 'Editing details for Fjord Supply');
  await visit('/settings/monitors', 'Fjord Supply storefront');
  await visit('/settings/monitors/1', 'Editing details for Fjord Supply storefront');
  await visit('/settings/users', 'Demo viewer');
  await visit(`/settings/users/${viewer}`, 'Editing details for viewer@example.test');
  await visit('/settings/jobs', 'Recent executions');
  const tenantPicker = page.getByLabel('Tenant', { exact: true }).first();
  if (await tenantPicker.evaluate(element => element.tagName) === 'SELECT') await tenantPicker.selectOption({ value: tenant });
  else {
    await tenantPicker.click();
    await page.getByRole('option', { name: 'Fjord Supply (B2B)', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Execute Backfill' }).click();
  await page.getByText('Backfill initiated.', { exact: true }).waitFor();
  await visit('/settings/diagnostics', 'Sample orders refreshed.');
  await visit('/settings/authentication', 'Demo administrator');
  const kiosk = await context.newPage();
  await kiosk.goto(url('/kiosk'));
  await kiosk.getByRole('heading', { name: 'Activate kiosk display' }).waitFor();
  const code = await kiosk.getByText(/^[A-F0-9]{6}$/).innerText();
  await page.getByLabel('Activation Code').fill(code);
  await page.getByRole('button', { name: 'Activate Kiosk' }).click();
  await kiosk.waitForURL(/fleet-status/);
  await kiosk.getByText('Current fleet', { exact: true }).waitFor();
  await kiosk.close();

  await visit('/swagger', 'Demo API explorer');
  await page.getByRole('button', { name: 'Send local request' }).click();
  await page.getByText(/HTTP 200/).waitFor();
  assert.match(await page.locator('pre').innerText(), /"role":"PlatformAdmin"/);

  const feed = await context.request.get(url('/api/intranet/calendar/feed.ics'));
  assert.equal(feed.status(), 200);
  assert.match(await feed.text(), /^BEGIN:VCALENDAR\r?\n[\s\S]+END:VCALENDAR/);
  if (!['localhost', '127.0.0.1'].includes(base.hostname)) assert.match(feed.headers()['content-type'], /^text\/calendar/);
  for (const path of ['/openapi/v1.json', '/swagger/v1/swagger.json']) {
    const spec = await context.request.get(url(path));
    assert.equal(spec.status(), 200);
    assert.ok((await spec.json()).paths['/api/users/me'].get);
  }
  for (const path of ['/health/live', '/health/ready']) {
    const probe = await context.request.get(url(path));
    assert.equal(probe.status(), 200);
    assert.equal((await probe.text()).trim(), 'Healthy');
  }
  await visit('/settings/platform', 'Open Hangfire Dashboard');
  await page.getByRole('button', { name: 'About this demo' }).click();
  await page.getByRole('button', { name: 'Reset demo' }).click();
  await page.waitForURL(/\/financial/);
  await page.getByText('Transaction Volume', { exact: true }).first().waitFor();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await visit('/settings/platform', 'Open Hangfire Dashboard');
  await page.getByRole('cell', { name: 'Northstar Commerce', exact: true }).waitFor();
  assert.equal(await page.getByRole('cell', { name: 'Browser test organization', exact: true }).count(), 0);
  assert.ok(servedAssets.size > 10);
  assert.deepEqual(errors, []);
  console.log(`Static demo smoke passed in ${engine.name()} at ${base.origin} with ${servedAssets.size} assets and zero unexpected requests or browser errors.`);
} catch (error) {
  console.error("Browser state", page.url(), (await page.locator("body").innerText().catch(() => "")).slice(0, 1600), errors);
  throw error;
} finally {
  if (trace) {
    await mkdir(new URL('.', `file://${trace}`), { recursive: true });
    await context.tracing.stop({ path: trace });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(trace + '.network.json', JSON.stringify({ base: base.origin, requests, errors }, null, 2));
  }
  await browser.close();
}
