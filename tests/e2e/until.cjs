// 신청 마감 날짜 점검 (Playwright). BOOKING_UNTIL=2027-01-24 로 띄운 서버 대상.
const { chromium, devices } = require('playwright');
const out = process.argv[2];
const base = process.env.BASE_URL || 'http://localhost:3100';
(async () => {
  const b = await chromium.launch();
  const errors = [];
  const m = await (await b.newContext({ ...devices['iPhone 13'] })).newPage();
  m.on('pageerror', (e) => errors.push(String(e)));
  await m.goto(base); await m.waitForSelector('.day');
  await m.evaluate(() => localStorage.setItem('meet.view', 'month'));
  console.log('안내:', await m.locator('.calendar__foot').textContent());
  while (await m.locator('button[aria-label="다음 달"]').isEnabled()) { await m.click('button[aria-label="다음 달"]'); await m.waitForTimeout(300); }
  console.log('마지막 달:', await m.locator('.calendar__head h2').textContent());
  console.log('1월 24일:', await m.locator('.day[aria-label^="1월 24일 "]').getAttribute('aria-label'));
  console.log('1월 25일:', await m.locator('.day[aria-label^="1월 25일 "]').getAttribute('aria-label'), '눌림:', await m.locator('.day[aria-label^="1월 25일 "]').isEnabled());
  await m.screenshot({ path: `${out}/m-jan.png`, fullPage: true });
  await m.click('.segmented >> text=주간'); await m.waitForTimeout(300);
  while (await m.locator('button[aria-label="다음 주"]').isEnabled()) { await m.click('button[aria-label="다음 주"]'); await m.waitForTimeout(200); }
  console.log('마지막 주:', await m.locator('.calendar__head h2').textContent());
  console.log('errors:', JSON.stringify(errors));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
