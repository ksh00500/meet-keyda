import { addDays, isDate, isTime, stamp, timeToMin, weekday, type Range } from './time.js';

export const MAX_REPEAT_BLOCKS = 200;
export const MAX_REPEAT_DAYS = 366;

export interface RepeatRule {
  /** 0=일요일 … 6=토요일 */
  weekdays: number[];
  startTime: string;
  endTime: string;
  from: string;
  until: string;
}

export type RepeatResult = { ok: true; ranges: Range[] } | { ok: false; message: string };

export function expandRepeat(rule: RepeatRule): RepeatResult {
  const { weekdays, startTime, endTime, from, until } = rule;
  if (!isDate(from) || !isDate(until)) return { ok: false, message: 'from/until은 YYYY-MM-DD 형식이어야 합니다' };
  if (until < from) return { ok: false, message: 'until이 from보다 앞입니다' };
  if (!isTime(startTime) || !isTime(endTime)) return { ok: false, message: '시간은 HH:MM 형식이어야 합니다' };
  if (timeToMin(endTime) <= timeToMin(startTime)) {
    return { ok: false, message: 'endTime은 startTime보다 뒤여야 합니다 (자정을 넘기면 24:00까지만)' };
  }
  const days = new Set(weekdays);
  if (days.size === 0 || [...days].some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    return { ok: false, message: 'weekdays는 0(일)~6(토) 숫자 목록이어야 합니다' };
  }
  const ranges: Range[] = [];
  let count = 0;
  for (let d = from; d <= until; d = addDays(d, 1)) {
    if (++count > MAX_REPEAT_DAYS) return { ok: false, message: `반복 기간은 최대 ${MAX_REPEAT_DAYS}일입니다` };
    if (!days.has(weekday(d))) continue;
    ranges.push({ start: stamp(d, startTime), end: stamp(d, endTime) });
    if (ranges.length > MAX_REPEAT_BLOCKS) {
      return { ok: false, message: `한 번에 최대 ${MAX_REPEAT_BLOCKS}개까지 만들 수 있습니다` };
    }
  }
  if (ranges.length === 0) return { ok: false, message: '조건에 맞는 날짜가 없습니다' };
  return { ok: true, ranges };
}
