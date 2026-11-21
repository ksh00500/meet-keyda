// 시간 막대 점검 (Playwright). 빈 DB + SEED_DEMO=1 서버 대상: node tests/e2e/timeline.cjs <스크린샷 폴더>
const { chromium, devices } = require('playwright');
const out = process.argv[2]; const base = process.env.BASE_URL || 'http://localhost:3100';
(async () => {
  const b = await chromium.launch(); const errors = [];
  const m = await (await b.newContext({ ...devices['iPhone 13'] })).newPage();
  m.on('pageerror', (e) => errors.push(String(e)));
  await m.goto(base); await m.waitForSelector('.day');
  await m.click('button[aria-label^="11월 24일"]'); await m.waitForTimeout(350);
  await m.screenshot({ path: `${out}/m1-bar.png` });
  // 빈 시간 알약 누르기
  await m.click('.free-pill >> nth=1'); await m.waitForTimeout(250);
  console.log('알약 후 버튼:', await m.locator('.sheet-cta button').textContent());
  await m.screenshot({ path: `${out}/m2-pill.png` });
  // 막대 빈 곳(16시쯤) 누르기
  const box = await m.locator('.panel .timeline__track').boundingBox();
  await m.mouse.click(box.x + box.width * ((16 * 60 - 480) / 900), box.y + box.height / 2); await m.waitForTimeout(250);
  console.log('막대 탭 후 버튼:', await m.locator('.sheet-cta button').textContent());
  // 불가 구간(20시) 누르면 변화 없음
  await m.mouse.click(box.x + box.width * ((20 * 60 - 480) / 900), box.y + box.height / 2); await m.waitForTimeout(250);
  console.log('불가 탭 후 버튼:', await m.locator('.sheet-cta button').textContent());
  await m.screenshot({ path: `${out}/m3-tap.png` });
  const d = await (await b.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
  await d.goto(base); await d.waitForSelector('.day');
  await d.click('button[aria-label^="11월 23일"]'); await d.click('.chip >> text=저녁');
  await d.screenshot({ path: `${out}/d1.png` });
  console.log('errors:', JSON.stringify(errors)); await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
