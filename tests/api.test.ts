import { describe, expect, it } from 'vitest';
import { jsonHeaders, makeApp, owner } from './helpers.js';

describe('친구 API', () => {
  it('설정, 신청, 캘린더 반영, 동시 신청 409', async () => {
    const { app } = makeApp();
    const cfg = await (await app.request('/api/config')).json();
    expect(cfg).toMatchObject({ title: '시호와 약속 잡기', bookableFrom: '2026-11-22', bookableTo: '2027-02-19' });
    expect(cfg.slots.map((s: { label: string }) => s.label)).toEqual(['점심', '저녁', '오전 반일', '오후 반일', '종일']);

    const body = { date: '2026-12-02', slot: 'dinner', name: '김민지', pin: '1234', memo: '파스타' };
    const r1 = await app.request('/api/bookings', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) });
    expect(r1.status).toBe(201);
    const b1 = await r1.json();
    expect(b1).toMatchObject({ status: 'pending', start: '2026-12-02T18:00', end: '2026-12-02T22:00' });
    expect(b1.token).toMatch(/^[0-9a-f]{64}$/);
    expect(b1).not.toHaveProperty('name');

    const r2 = await app.request('/api/bookings', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ ...body, name: '박준호' }),
    });
    expect(r2.status).toBe(409);

    const cal = await (await app.request('/api/calendar?month=2026-12')).json();
    const text = JSON.stringify(cal);
    expect(text).not.toContain('김민지');
    expect(text).not.toContain('파스타');
    expect(cal.days.find((d: { date: string }) => d.date === '2026-12-02').blocks).toEqual([
      { start: '2026-12-02T18:00', end: '2026-12-02T22:00', kind: 'booked' },
    ]);

    const mine = await (
      await app.request('/api/bookings/mine', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ tokens: [b1.token] }) })
    ).json();
    expect(mine.bookings.length).toBe(1);
  });

  it('잘못된 월은 400, 없는 API는 404', async () => {
    const { app } = makeApp();
    expect((await app.request('/api/calendar?month=2026-13')).status).toBe(400);
    expect((await app.request('/api/nope')).status).toBe(404);
  });

  it('이름 + PIN 잠금은 429와 남은 시간', async () => {
    const { app } = makeApp();
    const look = () =>
      app.request('/api/bookings/lookup', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ name: '누구', pin: '0000' }) });
    for (let i = 0; i < 4; i++) expect((await look()).status).toBe(404);
    const r = await look();
    expect(r.status).toBe(429);
    expect((await r.json()).retryAfterSec).toBe(600);
  });
});

describe('주인 API', () => {
  it('키가 없거나 틀리면 401', async () => {
    const { app } = makeApp();
    expect((await app.request('/api/owner/summary')).status).toBe(401);
    expect((await app.request('/api/owner/summary', { headers: { Authorization: 'Bearer wrong' } })).status).toBe(401);
    expect((await app.request('/api/owner/summary', { headers: owner })).status).toBe(200);
  });

  it('신청 목록과 수락, 친구 화면에 확정 반영', async () => {
    const { app } = makeApp();
    const r = await app.request('/api/bookings', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ date: '2026-12-02', slot: 'lunch', name: '김민지', pin: '1234' }),
    });
    const { id, token } = await r.json();
    const list = await (await app.request('/api/owner/bookings?status=pending', { headers: owner })).json();
    expect(list.bookings[0]).toMatchObject({ id, name: '김민지' });
    expect(JSON.stringify(list)).not.toMatch(/pin|token/i);
    const d = await app.request(`/api/owner/bookings/${id}/decide`, {
      method: 'POST',
      headers: owner,
      body: JSON.stringify({ action: 'confirm' }),
    });
    expect(d.status).toBe(200);
    const mine = await (
      await app.request('/api/bookings/mine', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ tokens: [token] }) })
    ).json();
    expect(mine.bookings[0].status).toBe('confirmed');
  });
});
