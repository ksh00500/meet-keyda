// 주간 보기 점검 (Playwright). 빈 DB + SEED_DEMO=1 서버 대상: node tests/e2e/weekview.cjs <스크린샷 폴더>
// 주의: 날짜(11월 24·26일)는 2026-11-21에 만든 시드 기준이다. 주는 월요일부터.
const { chromium, devices } = require('playwright');
const out = process.argv[2];
const base = process.env.BASE_URL || 'http://localhost:3100';
(async () => {
  const b = await chromium.launch();
  const errors = [];
  const m = await (await b.newContext({ ...devices['iPhone 13'] })).newPage();
  m.on('pageerror', (e) => errors.push(String(e)));
  m.on('console', (x) => x.type() === 'error' && errors.push(x.text()));
  await m.goto(base); await m.waitForSelector('.day');
  await m.screenshot({ path: `${out}/m-month.png`, fullPage: true });
  await m.click('.segmented >> text=주간'); await m.waitForSelector('.wrow:not(.wrow--scale)');
  await m.screenshot({ path: `${out}/m-week.png`, fullPage: true });
  console.log('주간 제목:', await m.locator('.calendar__head h2').textContent());
  console.log('처음 주 줄 수:', await m.locator('.wrow:not(.wrow--scale)').count());
  await m.click('button[aria-label="이전 주"]'); await m.waitForTimeout(400);
  console.log('이전 주 제목(지난 날 숨김):', await m.locator('.calendar__head h2').textContent(), '줄', await m.locator('.wrow:not(.wrow--scale)').count());
  await m.click('button[aria-label="다음 주"]'); await m.waitForTimeout(400);
  // 주간에서 신청
  await m.click('.wrow[aria-label^="11월 26일"]'); await m.waitForSelector('.panel'); await m.waitForTimeout(300);
  await m.click('.chip >> text=점심'); await m.click('.sheet-cta button');
  await m.fill('input[autocomplete=nickname]', '한지우'); await m.fill('input[inputmode=numeric]', '1357');
  await m.click('form .btn--primary'); await m.waitForSelector('.done');
  console.log('신청 후 시트 유지:', await m.locator('.done h3').textContent());
  await m.click('text=캘린더로 돌아가기'); await m.waitForTimeout(500);
  console.log('26일 줄 설명:', await m.locator('.wrow[aria-label^="11월 26일"]').getAttribute('aria-label'));
  await m.reload(); await m.waitForSelector('.wrow:not(.wrow--scale)');
  // 새로고침하면 첫 주로 돌아간다
  console.log('새로고침 후 보기 유지(주간):', await m.locator('.segmented [aria-selected=true]').textContent());
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  console.log('가로 넘침:', overflow);
  const d = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await d.goto(base); await d.waitForSelector('.day');
  await d.click('.segmented >> text=주간'); await d.waitForSelector('.wrow:not(.wrow--scale)');
  await d.click('.wrow[aria-label^="11월 24일"]'); await d.waitForSelector('.panel');
  await d.screenshot({ path: `${out}/d-week.png` });
  console.log('errors:', JSON.stringify(errors));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
