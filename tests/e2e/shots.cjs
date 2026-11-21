// 브라우저 점검 (Playwright). 빈 DB + SEED_DEMO=1 로 띄운 서버에 대해: OWNER_KEY=... node tests/e2e/shots.cjs <스크린샷 폴더>
// 주의: 클릭할 날짜(11월 24·25·29·30일)는 2026-11-21에 만든 시드 기준이라, 다른 날 실행하면 날짜를 바꿔야 합니다.
const { chromium, devices } = require('playwright');
const out = process.argv[2];
const base = process.env.BASE_URL || 'http://localhost:3100';
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  // 데스크톱
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(base); await p.waitForSelector('.day');
  await p.screenshot({ path: `${out}/1-calendar.png`, fullPage: true });
  await p.click('button[aria-label^="11월 24일"]');
  await p.waitForSelector('.panel');
  await p.screenshot({ path: `${out}/2-day.png`, fullPage: true });
  await p.click('.chip--custom');
  await p.selectOption('.custom label:nth-of-type(1) select', '18:00');
  await p.selectOption('.custom label:nth-of-type(2) select', '20:00');
  await p.screenshot({ path: `${out}/3-custom-conflict.png`, fullPage: true });
  await p.click('.chip >> text=점심');
  await p.click('.sheet-cta button');
  await p.fill('input[autocomplete=nickname]', '최유나');
  await p.fill('input[inputmode=numeric]', '5678');
  await p.fill('textarea', '연말 전에 밥 한번!');
  await p.click('form .btn--primary');
  await p.waitForSelector('.done');
  await p.screenshot({ path: `${out}/4-done.png`, fullPage: true });
  await p.click('text=내 신청 보기');
  await p.waitForSelector('.booking');
  await p.screenshot({ path: `${out}/5-mine.png`, fullPage: true });
  await p.goto(base + '/owner');
  await p.fill('input[type=password]', process.env.OWNER_KEY);
  await p.click('text=들어가기');
  await p.waitForSelector('.booking');
  await p.screenshot({ path: `${out}/6-owner.png`, fullPage: true });
  // 모바일
  const m = await browser.newContext({ ...devices['iPhone 13'] });
  const mp = await m.newPage();
  mp.on('pageerror', (e) => errors.push(String(e)));
  await mp.goto(base); await mp.waitForSelector('.day');
  await mp.screenshot({ path: `${out}/7-mobile.png`, fullPage: true });
  await mp.click('button[aria-label^="11월 24일"]');
  await mp.waitForSelector('.panel'); await mp.waitForTimeout(400);
  await mp.screenshot({ path: `${out}/8-mobile-day.png` });
  await mp.click('.chip >> text=직접 선택');
  await mp.selectOption('.custom label:nth-of-type(1) select', '14:00');
  await mp.selectOption('.custom label:nth-of-type(2) select', '17:00');
  await mp.screenshot({ path: `${out}/9-mobile-custom.png` });
  await mp.click('.sheet-cta button');
  await mp.waitForSelector('.chosen');
  await mp.screenshot({ path: `${out}/10-mobile-info.png` });
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  console.log('mobile horizontal overflow:', overflow);
  console.log('errors:', JSON.stringify(errors));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
