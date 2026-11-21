import { describe, expect, it } from 'vitest';
import { dayState, slotStatuses } from '../server/domain/availability.js';
import { expandRepeat } from '../server/domain/repeat.js';
import { bookableRange, clipToDay, nowKst, overlaps, slotRange } from '../server/domain/time.js';
import { FIXED_NOW } from './helpers.js';

describe('시간 규칙', () => {
  it('한국 시간 오늘과 신청 가능 기간(내일~90일)', () => {
    expect(nowKst(FIXED_NOW).date).toBe('2026-11-21');
    expect(bookableRange(FIXED_NOW)).toEqual({ from: '2026-11-22', to: '2027-02-19' });
    // 마감 날짜가 있으면 그날까지, 90일보다 늦으면 90일
    expect(bookableRange(FIXED_NOW, '2027-01-24')).toEqual({ from: '2026-11-22', to: '2027-01-24' });
    expect(bookableRange(FIXED_NOW, '2027-12-31').to).toBe('2027-02-19');
    // UTC로는 전날 밤이어도 한국은 다음 날
    expect(nowKst(new Date('2026-11-21T15:30:00Z')).date).toBe('2026-11-22');
  });

  it('끝 시각이 다른 구간의 시작과 같으면 겹치지 않음', () => {
    expect(overlaps('2026-12-01T11:30', '2026-12-01T14:00', '2026-12-01T14:00', '2026-12-01T18:00')).toBe(false);
    expect(overlaps('2026-12-01T11:30', '2026-12-01T14:00', '2026-12-01T13:59', '2026-12-01T18:00')).toBe(true);
  });

  it('시간대와 직접 선택을 구간으로 바꿈', () => {
    expect(slotRange('2026-12-01', 'lunch')).toEqual({ ok: true, range: { start: '2026-12-01T11:30', end: '2026-12-01T14:00' } });
    expect(slotRange('2026-12-01', 'custom', '22:00', '24:00')).toEqual({
      ok: true,
      range: { start: '2026-12-01T22:00', end: '2026-12-02T00:00' },
    });
    expect(slotRange('2026-12-01', 'custom', '15:15', '16:00').ok).toBe(false);
    expect(slotRange('2026-12-01', 'custom', '16:00', '16:00').ok).toBe(false);
    expect(slotRange('2026-02-30', 'lunch').ok).toBe(false);
  });

  it('여러 날에 걸친 일정을 날짜별로 자름', () => {
    const r = { start: '2026-12-05T20:00', end: '2026-12-07T10:00' };
    expect(clipToDay(r, '2026-12-05')).toEqual({ start: '2026-12-05T20:00', end: '2026-12-06T00:00' });
    expect(clipToDay(r, '2026-12-06')).toEqual({ start: '2026-12-06T00:00', end: '2026-12-07T00:00' });
    expect(clipToDay(r, '2026-12-08')).toBeNull();
  });
});

describe('가능 여부', () => {
  it('저녁만 막힌 날은 저녁·종일만 비활성, 상태는 일부 가능', () => {
    const blocks = [{ start: '2026-12-01T19:00', end: '2026-12-01T22:00', kind: 'busy' as const }];
    const s = Object.fromEntries(slotStatuses('2026-12-01', blocks).map((x) => [x.id, x.available]));
    expect(s).toEqual({ lunch: true, dinner: false, am: true, pm: true, allday: false });
    expect(dayState('2026-12-01', blocks, true)).toBe('partial');
  });

  it('종일 막히면 full, 기간 밖이면 closed, 아무것도 없으면 free', () => {
    const blocks = [{ start: '2026-12-01T00:00', end: '2026-12-02T00:00', kind: 'busy' as const }];
    expect(dayState('2026-12-01', blocks, true)).toBe('full');
    expect(dayState('2026-12-01', [], false)).toBe('closed');
    expect(dayState('2026-12-01', [], true)).toBe('free');
  });

  it('기본 시간대가 모두 막혀도 빈 30분이 있으면 partial (직접 선택 가능)', () => {
    const blocks = [
      { start: '2026-12-01T11:30', end: '2026-12-01T14:00', kind: 'booked' as const },
      { start: '2026-12-01T19:00', end: '2026-12-01T22:00', kind: 'busy' as const },
    ];
    expect(slotStatuses('2026-12-01', blocks).every((x) => !x.available)).toBe(true);
    expect(dayState('2026-12-01', blocks, true)).toBe('partial');
    const filled = [...blocks, { start: '2026-12-01T09:00', end: '2026-12-01T11:30', kind: 'busy' as const }, { start: '2026-12-01T14:00', end: '2026-12-01T19:00', kind: 'busy' as const }];
    expect(dayState('2026-12-01', filled, true)).toBe('full');
  });

  it('busy가 booked보다 이유로 우선', () => {
    const blocks = [
      { start: '2026-12-01T12:00', end: '2026-12-01T13:00', kind: 'booked' as const },
      { start: '2026-12-01T13:00', end: '2026-12-01T13:30', kind: 'busy' as const },
    ];
    expect(slotStatuses('2026-12-01', blocks).find((x) => x.id === 'lunch')?.reason).toBe('busy');
  });
});

describe('반복 일정', () => {
  it('매주 화요일 19-22시, 12월', () => {
    const r = expandRepeat({ weekdays: [2], startTime: '19:00', endTime: '22:00', from: '2026-12-01', until: '2026-12-31' });
    expect(r.ok && r.ranges.map((x) => x.start)).toEqual([
      '2026-12-01T19:00',
      '2026-12-08T19:00',
      '2026-12-15T19:00',
      '2026-12-22T19:00',
      '2026-12-29T19:00',
    ]);
  });
  it('잘못된 입력은 거부', () => {
    expect(expandRepeat({ weekdays: [], startTime: '19:00', endTime: '22:00', from: '2026-12-01', until: '2026-12-31' }).ok).toBe(false);
    expect(expandRepeat({ weekdays: [1], startTime: '22:00', endTime: '19:00', from: '2026-12-01', until: '2026-12-31' }).ok).toBe(false);
    expect(expandRepeat({ weekdays: [0, 1, 2, 3, 4, 5, 6], startTime: '09:00', endTime: '10:00', from: '2026-01-01', until: '2026-12-31' }).ok).toBe(false);
  });
});

describe('캘린더 칸 세 구간', async () => {
  const { periodStates, daySummary } = await import('../server/domain/availability.js');
  it('저녁 불가, 점심 예약이면 오전 some · 오후 some · 저녁 busy', () => {
    const blocks = [
      { start: '2026-12-01T11:30', end: '2026-12-01T14:00', kind: 'booked' as const },
      { start: '2026-12-01T19:00', end: '2026-12-01T22:00', kind: 'busy' as const },
    ];
    const s = periodStates('2026-12-01', blocks);
    expect(s).toEqual(['some', 'some', 'some']);
    expect(daySummary(s)).toBe('일부 시간 가능');
    const s2 = periodStates('2026-12-01', [{ start: '2026-12-01T18:00', end: '2026-12-01T22:00', kind: 'busy' as const }]);
    expect(s2).toEqual(['free', 'free', 'busy']);
    expect(daySummary(s2)).toBe('오전·오후 가능');
    expect(daySummary(periodStates('2026-12-01', []))).toBe('종일 가능');
    // 오전·오후 불가, 저녁은 18–19시만 빔
    const s3 = periodStates('2026-12-01', [
      { start: '2026-12-01T09:00', end: '2026-12-01T18:00', kind: 'busy' as const },
      { start: '2026-12-01T19:00', end: '2026-12-01T22:00', kind: 'busy' as const },
    ]);
    expect(s3).toEqual(['busy', 'busy', 'some']);
    expect(daySummary(s3)).toBe('저녁 일부 가능');
  });
});
