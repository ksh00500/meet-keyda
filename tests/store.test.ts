import { describe, expect, it } from 'vitest';
import { seedDemo } from '../server/seed.js';
import { FIXED_NOW, makeStore } from './helpers.js';

const base = { name: '김민지', pin: '1234', memo: '파스타' };

describe('신청', () => {
  it('신청하면 pending, 같은 시간 두 번째 신청은 conflict', () => {
    const { store } = makeStore();
    const a = store.createBooking({ ...base, date: '2026-12-02', slot: 'lunch' });
    expect(a.ok && a.booking.status).toBe('pending');
    const b = store.createBooking({ ...base, name: '박준호', date: '2026-12-02', slot: 'custom', start: '13:00', end: '15:00' });
    expect(!b.ok && b.error).toBe('conflict');
    // 끝과 시작이 맞닿으면 가능
    const c = store.createBooking({ ...base, name: '박준호', date: '2026-12-02', slot: 'custom', start: '14:00', end: '15:00' });
    expect(c.ok).toBe(true);
  });

  it('불가능 시간과 겹치면 막고, 거절·취소된 신청은 막지 않음', () => {
    const { store } = makeStore();
    store.addBusy([{ start: '2026-12-01T19:00', end: '2026-12-01T22:00', title: '회의' }]);
    const a = store.createBooking({ ...base, date: '2026-12-01', slot: 'dinner' });
    expect(!a.ok && a.error).toBe('conflict');
    const b = store.createBooking({ ...base, date: '2026-12-03', slot: 'dinner' });
    if (!b.ok) throw new Error();
    store.decide(b.booking.id, 'reject');
    expect(store.createBooking({ ...base, date: '2026-12-03', slot: 'dinner' }).ok).toBe(true);
  });

  it('오늘·지난 날·90일 넘는 날은 거부, 입력 검사', () => {
    const { store } = makeStore();
    expect(store.createBooking({ ...base, date: '2026-11-21', slot: 'dinner' }).ok).toBe(false);
    expect(store.createBooking({ ...base, date: '2026-11-22', slot: 'dinner' }).ok).toBe(true);
    expect(store.createBooking({ ...base, date: '2027-02-19', slot: 'dinner' }).ok).toBe(true);
    expect(store.createBooking({ ...base, date: '2027-02-20', slot: 'dinner' }).ok).toBe(false);
    expect(store.createBooking({ ...base, pin: '12a4', date: '2026-12-10', slot: 'lunch' }).ok).toBe(false);
    expect(store.createBooking({ ...base, name: '  ', date: '2026-12-10', slot: 'lunch' }).ok).toBe(false);
    expect(store.createBooking({ ...base, name: 'ㄱ'.repeat(21), date: '2026-12-10', slot: 'lunch' }).ok).toBe(false);
  });

  it('BOOKING_UNTIL: 그날까지만 받고, 캘린더에서 이후는 closed', () => {
    const { store } = makeStore(FIXED_NOW, '2027-01-24');
    expect(store.createBooking({ ...base, date: '2027-01-24', slot: 'dinner' }).ok).toBe(true);
    const late = store.createBooking({ ...base, date: '2027-01-25', slot: 'dinner' });
    expect(!late.ok && late.message).toBe('내일부터 1월 24일까지만 신청할 수 있어요');
    const cal = store.calendar('2027-01');
    if ('ok' in cal) throw new Error();
    expect(cal.days.find((d) => d.date === '2027-01-24')?.state).not.toBe('closed');
    expect(cal.days.find((d) => d.date === '2027-01-25')?.state).toBe('closed');
  });

  it('PIN 원문이 DB에 남지 않음', () => {
    const { store } = makeStore();
    store.createBooking({ ...base, pin: '4821', date: '2026-12-02', slot: 'lunch' });
    const row = store.db.prepare('SELECT pin_hash FROM bookings').get() as { pin_hash: string };
    expect(row.pin_hash).not.toContain('4821');
    expect(row.pin_hash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{64}$/);
  });
});

describe('친구 캘린더 보기', () => {
  it('제목·이름·메모 없이 구간과 종류만', () => {
    const { store } = makeStore();
    store.addBusy([{ start: '2026-12-01T19:00', end: '2026-12-01T22:00', title: '비밀 회의' }]);
    store.createBooking({ ...base, date: '2026-12-02', slot: 'lunch' });
    const cal = store.calendar('2026-12');
    if ('ok' in cal) throw new Error();
    const text = JSON.stringify(cal);
    expect(text).not.toContain('비밀 회의');
    expect(text).not.toContain('김민지');
    expect(text).not.toContain('파스타');
    expect(cal.days.find((d) => d.date === '2026-12-01')).toMatchObject({ state: 'partial', blocks: [{ kind: 'busy' }] });
    expect(cal.days.find((d) => d.date === '2026-12-02')?.blocks[0].kind).toBe('booked');
  });

  it('지난 날과 오늘은 closed', () => {
    const { store } = makeStore();
    const cal = store.calendar('2026-11');
    if ('ok' in cal) throw new Error();
    expect(cal.days.find((d) => d.date === '2026-11-21')?.state).toBe('closed');
    expect(cal.days.find((d) => d.date === '2026-11-22')?.state).toBe('free');
  });
});

describe('내 신청 찾기 (토큰, 이름 + PIN)', () => {
  it('토큰으로 찾고, 이름 + PIN으로 다른 기기에서 찾음', () => {
    const { store } = makeStore();
    const a = store.createBooking({ ...base, date: '2026-12-02', slot: 'lunch' });
    if (!a.ok) throw new Error();
    expect(store.bookingsByTokens([a.token]).map((b) => b.id)).toEqual([a.booking.id]);
    const l = store.lookup(' 김민지 ', '1234');
    expect(l.ok && l.bookings.map((b) => b.id)).toEqual([a.booking.id]);
    // 새로 받은 토큰으로도 찾을 수 있음
    if (!l.ok) throw new Error();
    expect(store.bookingsByTokens([l.bookings[0].token]).length).toBe(1);
  });

  it('같은 이름이라도 PIN이 다르면 다른 사람', () => {
    const { store } = makeStore();
    store.createBooking({ ...base, date: '2026-12-02', slot: 'lunch' });
    store.createBooking({ ...base, pin: '9999', date: '2026-12-03', slot: 'lunch' });
    const l = store.lookup('김민지', '9999');
    expect(l.ok && l.bookings.map((b) => b.start)).toEqual(['2026-12-03T11:30']);
  });

  it('PIN 5번 틀리면 10분 잠금, 10분 뒤 풀림', () => {
    const { store, setNow } = makeStore();
    store.createBooking({ ...base, date: '2026-12-02', slot: 'lunch' });
    for (let i = 0; i < 4; i++) expect(store.lookup('김민지', '0000')).toMatchObject({ ok: false, error: 'not_found' });
    expect(store.lookup('김민지', '0000')).toMatchObject({ ok: false, error: 'locked' });
    // 잠긴 동안은 맞는 PIN도 거부
    expect(store.lookup('김민지', '1234')).toMatchObject({ ok: false, error: 'locked' });
    setNow(new Date(FIXED_NOW.getTime() + 10 * 60_000 + 1000));
    expect(store.lookup('김민지', '1234').ok).toBe(true);
  });

  it('친구 취소: 자기 토큰 + 신청 중만', () => {
    const { store } = makeStore();
    const a = store.createBooking({ ...base, date: '2026-12-02', slot: 'lunch' });
    const b = store.createBooking({ ...base, name: '박준호', date: '2026-12-03', slot: 'lunch' });
    if (!a.ok || !b.ok) throw new Error();
    expect(store.cancelByFriend(a.booking.id, b.token)).toMatchObject({ ok: false, error: 'forbidden' });
    store.decide(b.booking.id, 'confirm');
    expect(store.cancelByFriend(b.booking.id, b.token)).toMatchObject({ ok: false, error: 'not_pending' });
    expect(store.cancelByFriend(a.booking.id, a.token)).toMatchObject({ ok: true, booking: { status: 'cancelled' } });
    // 취소한 시간은 다시 열림
    expect(store.createBooking({ ...base, name: '이서연', date: '2026-12-02', slot: 'lunch' }).ok).toBe(true);
  });
});

describe('주인 기능', () => {
  it('불가능 시간 등록 시 겹친 신청을 알려 줌 (내 일정 우선)', () => {
    const { store } = makeStore();
    const a = store.createBooking({ ...base, date: '2026-12-02', slot: 'dinner' });
    if (!a.ok) throw new Error();
    const r = store.addBusy([{ start: '2026-12-02T20:00', end: '2026-12-02T23:00', title: '야근' }]);
    expect(r.ok && r.conflicts.map((c) => c.id)).toEqual([a.booking.id]);
  });

  it('반복 일정 등록과 묶음 삭제', () => {
    const { store } = makeStore();
    const r = store.addRepeat({ weekdays: [2], startTime: '19:00', endTime: '22:00', from: '2026-12-01', until: '2026-12-31' }, '스터디');
    if (!r.ok) throw new Error(r.message);
    expect(r.created.length).toBe(5);
    expect(store.removeBusy({ seriesId: r.seriesId })).toEqual({ ok: true, removed: 5 });
  });

  it('수락·거절은 신청 중일 때만, 확정 약속 취소', () => {
    const { store } = makeStore();
    const a = store.createBooking({ ...base, date: '2026-12-02', slot: 'dinner' });
    if (!a.ok) throw new Error();
    expect(store.decide(a.booking.id, 'confirm')).toMatchObject({ ok: true, booking: { status: 'confirmed' } });
    expect(store.decide(a.booking.id, 'reject')).toMatchObject({ ok: false, error: 'not_pending' });
    expect(store.cancelBooking(a.booking.id, '급한 일정')).toMatchObject({ ok: true, booking: { status: 'cancelled', reason: '급한 일정' } });
    expect(store.summary().pendingCount).toBe(0);
  });

  it('시드는 빈 DB에만 한 번', () => {
    const { store } = makeStore();
    expect(seedDemo(store, FIXED_NOW)).toBe(true);
    expect(seedDemo(store, FIXED_NOW)).toBe(false);
    expect(store.listBookings({ status: 'all' }).length).toBe(3);
    expect(store.summary().pendingCount).toBe(1);
  });
});
