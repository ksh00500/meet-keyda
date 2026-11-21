// 브라우저 점검 (Playwright). shots.cjs 다음에 실행: OWNER_KEY=... node tests/e2e/flow2.cjs
// 주의: 클릭할 날짜(11월 24·25·29·30일)는 2026-11-21에 만든 시드 기준이라, 다른 날 실행하면 날짜를 바꿔야 합니다.
const { chromium } = require('playwright');
const base = process.env.BASE_URL || 'http://localhost:3100';
(async () => {
  const b = await chromium.launch();
  const errors = [];
  // 친구 A가 신청
  const a = await (await b.newContext()).newPage();
  a.on('pageerror', (e) => errors.push(String(e)));
  await a.goto(base); await a.waitForSelector('.day');
  await a.click('button[aria-label^="11월 30일"]');
  await a.click('.chip >> text=저녁');
  await a.fill('input[autocomplete=nickname]', '정다은');
  await a.fill('input[inputmode=numeric]', '2468');
  await a.click('form .btn--primary'); await a.waitForSelector('.done');
  // 주인이 수락
  const o = await (await b.newContext()).newPage();
  o.on('dialog', (d) => d.accept());
  await o.goto(base + '/owner');
  await o.fill('input[type=password]', process.env.OWNER_KEY);
  await o.click('text=들어가기'); await o.waitForSelector('.booking');
  await o.locator('.booking', { hasText: '정다은' }).locator('text=수락').click();
  await o.waitForTimeout(500);
  // 다른 기기에서 이름 + PIN으로 찾기 → 확정 보임
  const c = await (await b.newContext()).newPage();
  await c.goto(base + '/mine');
  await c.fill('.form--inline input >> nth=0', '정다은');
  await c.fill('.form--inline input >> nth=1', '2468');
  await c.click('text=찾기'); await c.waitForSelector('.booking');
  const status = await c.locator('.booking .badge').first().textContent();
  console.log('다른 기기 조회 상태:', status);
  // 틀린 PIN
  await c.fill('.form--inline input >> nth=1', '1111');
  await c.click('text=찾기'); await c.waitForTimeout(400);
  console.log('틀린 PIN 안내:', await c.locator('[role=status]').last().textContent());
  // 친구 A가 새 신청 후 직접 취소
  await a.goto(base); await a.waitForSelector('.day');
  await a.click('button[aria-label^="11월 29일"]');
  await a.click('.chip >> text=점심');
  await a.fill('input[autocomplete=nickname]', '정다은');
  await a.fill('input[inputmode=numeric]', '2468');
  await a.click('form .btn--primary'); await a.waitForSelector('.done');
  a.on('dialog', (d) => d.accept());
  await a.goto(base + '/mine'); await a.waitForSelector('.booking');
  await a.locator('.booking', { hasText: '11월 29일' }).locator('text=취소하기').click();
  await a.waitForTimeout(500);
  console.log('취소 후 상태:', await a.locator('.booking', { hasText: '11월 29일' }).locator('.badge').textContent());
  console.log('errors:', JSON.stringify(errors));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
