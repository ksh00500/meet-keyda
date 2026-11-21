// 관리자 화면 + 새 시간 구조 점검 (Playwright). 빈 DB + SEED_DEMO=1 + ADMIN_PASSWORD 로 띄운 서버 대상.
//   ADMIN_PASSWORD=... node tests/e2e/admin.cjs <스크린샷 폴더>
// 주의: 날짜는 2026-11-21에 만든 시드 기준이다.
const { chromium, devices } = require('playwright');
const out = process.argv[2];
const base = process.env.BASE_URL || 'http://localhost:3100';
(async () => {
  const b = await chromium.launch();
  const errors = [];
  const watch = (p) => p.on('pageerror', (e) => errors.push(String(e)));

  // 1) 친구: 점심만 예약된 날(11월 25일)에 오전·오후·저녁은 그대로 가능
  const f = await (await b.newContext({ ...devices['iPhone 13'] })).newPage(); watch(f);
  await f.goto(base); await f.waitForSelector('.day');
  await f.evaluate(() => localStorage.setItem('meet.view', 'month'));
  await f.click('.day[aria-label^="11월 25일 "]'); await f.waitForSelector('.panel'); await f.waitForTimeout(300);
  const chipState = async () => Object.fromEntries(await f.$$eval('.chips .chip', (els) => els.map((e) => [e.querySelector('.chip__label').textContent.trim(), e.disabled ? (e.querySelector('.chip__time').textContent) : 'ok'])));
  console.log('25일(점심 예약) 버튼:', JSON.stringify(await chipState()));
  console.log('25일 칸 설명:', await f.locator('.day[aria-label^="11월 25일 "]').getAttribute('aria-label'));
  // 이어 고르기: 오후 + 저녁? 24일은 저녁 불가라 26일로
  await f.keyboard.press('Escape');
  await f.click('.day[aria-label^="11월 29일 "]'); await f.waitForSelector('.panel'); await f.waitForTimeout(300);
  await f.click('.chips--four .chip >> text=오전'); await f.click('.chips--four .chip >> text=점심');
  console.log('오전+점심 →', await f.locator('.sheet-cta button').textContent());
  await f.click('.chips--four .chip >> text=저녁');
  console.log('떨어진 저녁 누르면 →', await f.locator('.sheet-cta button').textContent());
  await f.click('.chips--four .chip >> text=오후');
  console.log('오후 이어 붙임 →', await f.locator('.sheet-cta button').textContent());
  await f.screenshot({ path: `${out}/f-combo.png` });
  await f.click('.sheet-cta button');
  await f.fill('input[autocomplete=nickname]', '서지안'); await f.fill('input[inputmode=numeric]', '8642');
  await f.click('form .btn--primary'); await f.waitForSelector('.done');
  console.log('이어 붙인 칸 신청 완료:', await f.locator('.done__summary dd >> nth=1').textContent());

  // 2) 관리자
  const a = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); watch(a);
  a.on('dialog', (d) => d.accept());
  await a.goto(base + '/admin'); await a.waitForSelector('input[type=password]');
  await a.fill('input[type=password]', 'wrong-password'); await a.click('text=들어가기');
  console.log('틀린 비밀번호:', await a.locator('.field-error').textContent());
  await a.fill('input[type=password]', process.env.ADMIN_PASSWORD); await a.click('text=들어가기');
  await a.waitForSelector('.aday');
  console.log('새 신청 표시:', await a.locator('.pending-pill').textContent());
  await a.screenshot({ path: `${out}/a-calendar.png` });
  await a.click('button[aria-label="다음 달"]'); await a.waitForTimeout(400);
  await a.click('.aday[aria-label^="12월 2일"]'); await a.waitForSelector('.panel');
  await a.click('text=이날 불가능 시간 추가');
  await a.fill('.add-busy input[placeholder="예: 팀 회의"]', '팀 회의');
  await a.selectOption('.add-busy .custom label:nth-of-type(1) select', '19:00');
  await a.selectOption('.add-busy .custom label:nth-of-type(2) select', '21:00');
  await a.click('.add-busy >> text=등록하기'); await a.waitForSelector('.notice');
  console.log('추가 결과:', (await a.locator('.notice').first().textContent()).trim());
  console.log('2일 칸 항목:', await a.locator('.aday[aria-label^="12월 2일"] .aitem').allTextContents());
  // 반복 추가
  await a.click('text=이날 불가능 시간 추가');
  await a.fill('.add-busy input[placeholder="예: 팀 회의"]', '수요 스터디');
  await a.selectOption('.add-busy .custom label:nth-of-type(1) select', '09:00');
  await a.selectOption('.add-busy .custom label:nth-of-type(2) select', '12:00');
  await a.check('.add-busy >> text=매주');
  await a.click('.add-busy >> text=등록하기'); await a.waitForTimeout(600);
  console.log('반복 추가:', (await a.locator('.notice').first().textContent()).trim());
  await a.screenshot({ path: `${out}/a-day.png` });
  // 친구 화면 반영: 12월 2일 저녁 일부 불가
  const cal = await (await a.request.get(base + '/api/calendar?month=2026-12')).json();
  console.log('친구 API 12월 2일:', JSON.stringify(cal.days.find((d) => d.date === '2026-12-02').blocks), '제목 노출:', JSON.stringify(cal).includes('팀 회의'));
  // 반복 전체 삭제
  await a.locator('.alist__item', { hasText: '수요 스터디' }).locator('text=반복 전체').click(); await a.waitForTimeout(600);
  console.log('반복 삭제:', (await a.locator('.notice').first().textContent()).trim());
  // 신청 탭에서 수락
  await a.click('.tab >> text=신청'); await a.waitForSelector('.booking');
  await a.locator('.booking', { hasText: '서지안' }).locator('text=수락').click(); await a.waitForTimeout(500);
  console.log('수락:', (await a.locator('.notice').first().textContent()).trim());
  await a.screenshot({ path: `${out}/a-requests.png` });
  // 설정
  await a.click('.tab >> text=설정'); await a.waitForSelector('.settings');
  await a.fill('.settings input[maxlength="40"]', '시호랑 밥 먹자');
  if (await a.isChecked('.settings .check input')) await a.uncheck('.settings .check input');
  await a.fill('.settings input[type=date]', '2026-12-31');
  await a.click('.settings >> text=저장하기'); await a.waitForTimeout(500);
  const cfg = await (await a.request.get(base + '/api/config')).json();
  console.log('설정 반영:', cfg.title, cfg.bookableTo);
  await a.screenshot({ path: `${out}/a-settings.png` });
  // 휴대폰 관리자 캘린더
  const m = await (await b.newContext({ ...devices['iPhone 13'] })).newPage(); watch(m);
  await m.goto(base + '/admin'); await m.fill('input[type=password]', process.env.ADMIN_PASSWORD); await m.click('text=들어가기');
  await m.waitForSelector('.aday'); await m.screenshot({ path: `${out}/m-admin.png`, fullPage: true });
  console.log('휴대폰 가로 넘침:', await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth));
  // 로그아웃
  await a.click('text=로그아웃'); await a.waitForSelector('input[type=password]');
  console.log('로그아웃 후 주인 API:', (await a.request.get(base + '/api/owner/me')).status());
  console.log('errors:', JSON.stringify(errors));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
