import { chromium } from 'playwright';

const DIR = '/tmp/esim-screenshots/mobile';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
const page = await context.newPage();

// Auth pages (no login needed)
await page.goto('http://localhost:3000/auth/login');
await page.waitForTimeout(600);
await page.screenshot({ path: `${DIR}/01-login.png`, fullPage: true });
console.log('01-login OK');

await page.goto('http://localhost:3000/auth/register');
await page.waitForTimeout(600);
await page.screenshot({ path: `${DIR}/02-register.png`, fullPage: true });
console.log('02-register OK');

// Login
await page.goto('http://localhost:3000/auth/login');
await page.fill('input[name=username]', 'admin');
await page.fill('input[name=password]', 'test123');
await page.click('button[type=submit]');
await page.waitForURL('**/offers**', { timeout: 5000 });
await page.waitForTimeout(800);
console.log('Logged in');

// Offers
await page.screenshot({ path: `${DIR}/03-offers.png`, fullPage: true });
console.log('03-offers OK');

// Purchase modal on mobile
const firstOffer = await page.$('.offer-card');
if (firstOffer) {
  await firstOffer.click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${DIR}/04-modal.png` });
  console.log('04-modal OK');
  // Close modal via JS
  await page.evaluate(() => {
    const modal = document.getElementById('purchaseModal');
    if (modal) modal.style.display = 'none';
  });
  await page.waitForTimeout(200);
}

// Sidebar
const menuBtn = await page.$('.mobile-header button');
if (menuBtn) {
  await menuBtn.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${DIR}/05-sidebar.png` });
  console.log('05-sidebar OK');
  // Close sidebar via JS
  await page.evaluate(() => { if (typeof closeSidebar === 'function') closeSidebar(); });
  await page.waitForTimeout(300);
}

// Purchases
await page.goto('http://localhost:3000/purchases');
await page.waitForTimeout(800);
await page.screenshot({ path: `${DIR}/06-purchases.png`, fullPage: true });
console.log('06-purchases OK');

// Status
const statusLink = await page.$('a[href^="/status/"]');
if (statusLink) {
  await statusLink.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${DIR}/07-status.png`, fullPage: true });
  console.log('07-status OK');
}

// Profile
await page.goto('http://localhost:3000/profile');
await page.waitForTimeout(800);
await page.screenshot({ path: `${DIR}/08-profile.png`, fullPage: true });
console.log('08-profile OK');

// Admin dashboard
await page.goto('http://localhost:3000/admin/dashboard');
await page.waitForTimeout(800);
await page.screenshot({ path: `${DIR}/09-admin-dashboard.png`, fullPage: true });
console.log('09-admin-dashboard OK');

// Admin users
await page.goto('http://localhost:3000/admin/users');
await page.waitForTimeout(800);
await page.screenshot({ path: `${DIR}/10-admin-users.png`, fullPage: true });
console.log('10-admin-users OK');

// Admin eSIMs
await page.goto('http://localhost:3000/admin/esims');
await page.waitForTimeout(800);
await page.screenshot({ path: `${DIR}/11-admin-esims.png`, fullPage: true });
console.log('11-admin-esims OK');

// Admin eSIM detail (navigate directly since table link is hidden on mobile)
const detailLink = await page.$('.md\\:hidden a[href^="/admin/esims/"]');
if (detailLink) {
  await detailLink.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${DIR}/12-esim-detail.png`, fullPage: true });
  console.log('12-esim-detail OK');
} else {
  // Fallback: navigate directly to first esim detail
  await page.goto('http://localhost:3000/admin/esims/1');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${DIR}/12-esim-detail.png`, fullPage: true });
  console.log('12-esim-detail OK (direct nav)');
}

// Dark mode mobile
await page.goto('http://localhost:3000/offers');
await page.evaluate(() => document.documentElement.classList.add('dark'));
await page.waitForTimeout(600);
await page.screenshot({ path: `${DIR}/13-offers-dark.png`, fullPage: true });
console.log('13-offers-dark OK');

await page.goto('http://localhost:3000/admin/dashboard');
await page.evaluate(() => document.documentElement.classList.add('dark'));
await page.waitForTimeout(600);
await page.screenshot({ path: `${DIR}/14-admin-dark.png`, fullPage: true });
console.log('14-admin-dark OK');

await browser.close();
console.log('\nDone! All mobile screenshots saved.');
