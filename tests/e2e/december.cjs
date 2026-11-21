// 12월 화면 점검 (Playwright). 2026-11-21 기준 시드 + 12월 일정(반복·여러 날·연말)을 넣은 서버 대상.
const { chromium, devices } = require('playwright');
const out = process.argv[2];
const base = process.env.BASE_URL || 'http://localhost:3100';
(async () => {
  const b = await chromium.launch();
  const errors = [];
  const watch = (p) => { p.on('pageerror', (e) => errors.push(String(e))); p.on('console', (x) => x.type() === 'error' && errors.push(x.text())); };
  const m = await (await b.newContext({ ...devices['iPhone 13'] })).newPage(); watch(m);
  await m.goto(base); await m.waitForSelector('.day');
  await m.evaluate(() => localStorage.setItem('meet.view', 'month'));
  await m.click('button[aria-label="다음 달"]'); await m.waitForTimeout(500);
  console.log('월 제목:', await m.locator('.calendar__head h2').textContent());
  console.log('12월 칸 수:', await m.locator('.grid--days .day').count());
  for (const d of ['12월 1일', '12월 8일', '12월 12일', '12월 21일', '12월 25일', '12월 31일']) {
    console.log(' ', await m.locator(`.day[aria-label^="${d} "]`).getAttribute('aria-label'));
  }
  await m.screenshot({ path: `${out}/m-dec-month.png`, fullPage: true });
  await m.click('.segmented >> text=주간'); await m.waitForTimeout(400);
  console.log('주간으로 바꾼 뒤:', await m.locator('.calendar__head h2').textContent());
  for (let i = 0; i < 3; i++) { await m.click('button[aria-label="다음 주"]'); await m.waitForTimeout(250); }
  console.log('크리스마스 주:', await m.locator('.calendar__head h2').textContent());
  await m.screenshot({ path: `${out}/m-dec-week-xmas.png`, fullPage: true });
  await m.click('button[aria-label="다음 주"]'); await m.waitForTimeout(400);
  console.log('연말 주:', await m.locator('.calendar__head h2').textContent(), '줄 수', await m.locator('.wrow:not(.wrow--scale)').count());
  await m.screenshot({ path: `${out}/m-dec-week-newyear.png`, fullPage: true });
  const d = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage(); watch(d);
  await d.goto(base); await d.waitForSelector('.day');
  await d.click('button[aria-label="다음 달"]'); await d.waitForTimeout(500);
  await d.click('.day[aria-label^="12월 26일 "]'); await d.waitForSelector('.panel');
  await d.screenshot({ path: `${out}/d-dec-month.png` });
  // 마지막 달까지 넘기기
  for (let i = 0; i < 3; i++) if (await d.locator('button[aria-label="다음 달"]').isEnabled()) { await d.click('button[aria-label="다음 달"]'); await d.waitForTimeout(300); }
  console.log('마지막 달:', await d.locator('.calendar__head h2').textContent(), '다음 달 버튼 활성:', await d.locator('button[aria-label="다음 달"]').isEnabled());
  console.log('2월 20일:', await d.locator('.day[aria-label^="2월 20일 "]').getAttribute('aria-label'));
  console.log('errors:', JSON.stringify(errors));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
