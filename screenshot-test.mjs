import { chromium } from 'playwright';

const DIR = '/tmp/esim-screenshots';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

// Login
await page.goto('http://localhost:3000/auth/login');
await page.fill('input[name=username]', 'admin');
await page.fill('input[name=password]', 'test123');
await page.click('button[type=submit]');
await page.waitForURL('**/offers**', { timeout: 5000 });
await page.waitForTimeout(800);
console.log('Logged in');

// 4. Offers
await page.screenshot({ path: `${DIR}/04-offers.png`, fullPage: true });
console.log('04-offers OK');

// 5. Purchase modal
const firstOffer = await page.$('.offer-card');
if (firstOffer) {
  await firstOffer.click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${DIR}/05-modal.png` });
  console.log('05-modal OK');
  await page.keyboard.press('Escape');
  await page.click('.modal-backdrop').catch(() => {});
  await page.waitForTimeout(200);
}

// 6. Purchases
await page.goto('http://localhost:3000/purchases');
await page.waitForTimeout(800);
await page.screenshot({ path: `${DIR}/06-purchases.png`, fullPage: true });
console.log('06-purchases OK');

// 7. Status
const statusLink = await page.$('a[href^="/status/"]');
if (statusLink) {
  await statusLink.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${DIR}/07-status.png`, fullPage: true });
  console.log('07-status OK');
}

// 8. Profile
await page.goto('http://localhost:3000/profile');
await page.waitForTimeout(800);
await page.screenshot({ path: `${DIR}/08-profile.png`, fullPage: true });
console.log('08-profile OK');

// 9. Admin dashboard
await page.goto('http://localhost:3000/admin/dashboard');
await page.waitForTimeout(800);
await page.screenshot({ path: `${DIR}/09-admin-dashboard.png`, fullPage: true });
console.log('09-admin-dashboard OK');

// 10. Admin users
await page.goto('http://localhost:3000/admin/users');
await page.waitForTimeout(800);
await page.screenshot({ path: `${DIR}/10-admin-users.png`, fullPage: true });
console.log('10-admin-users OK');

// 11. Admin eSIMs
await page.goto('http://localhost:3000/admin/esims');
await page.waitForTimeout(800);
await page.screenshot({ path: `${DIR}/11-admin-esims.png`, fullPage: true });
console.log('11-admin-esims OK');

// 12. Admin eSIM detail
const detailLink = await page.$('a[href^="/admin/esims/"]');
if (detailLink) {
  await detailLink.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${DIR}/12-esim-detail.png`, fullPage: true });
  console.log('12-esim-detail OK');
}

// 13. Dark mode - Offers
await page.goto('http://localhost:3000/offers');
await page.evaluate(() => document.documentElement.classList.add('dark'));
await page.waitForTimeout(500);
await page.screenshot({ path: `${DIR}/13-offers-dark.png`, fullPage: true });
console.log('13-offers-dark OK');

// 14. Dark mode - Admin dashboard
await page.goto('http://localhost:3000/admin/dashboard');
await page.evaluate(() => document.documentElement.classList.add('dark'));
await page.waitForTimeout(500);
await page.screenshot({ path: `${DIR}/14-admin-dark.png`, fullPage: true });
console.log('14-admin-dark OK');

// 15. Mobile - Offers
await page.setViewportSize({ width: 375, height: 812 });
await page.goto('http://localhost:3000/offers');
await page.evaluate(() => document.documentElement.classList.remove('dark'));
await page.waitForTimeout(800);
await page.screenshot({ path: `${DIR}/15-mobile-offers.png`, fullPage: true });
console.log('15-mobile-offers OK');

// 16. Mobile - Sidebar open
const menuBtn = await page.$('.mobile-header button');
if (menuBtn) {
  await menuBtn.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${DIR}/16-mobile-sidebar.png` });
  console.log('16-mobile-sidebar OK');
}

await browser.close();
console.log('\nDone! All screenshots saved.');
