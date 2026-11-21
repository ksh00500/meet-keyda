// 시간 규칙. 서버와 화면이 함께 쓰므로 Node 전용 기능을 쓰지 않는다.
// 모든 시각은 한국 시간(Asia/Seoul, 서머타임 없음) 문자열 "YYYY-MM-DDTHH:MM".
// 구간은 시작 포함, 끝 제외. 하루 끝 24:00은 다음 날 "T00:00"으로 쓴다.

export const KST_OFFSET_MIN = 9 * 60;
export const BOOKABLE_DAYS = 90;
export const STEP_MIN = 30;

export type SlotId = 'lunch' | 'dinner' | 'am' | 'pm' | 'allday';
export type SlotKind = SlotId | 'custom';

export interface SlotDef {
  id: SlotId;
  label: string;
  start: string; // HH:MM
  end: string; // HH:MM
}

export const SLOTS: SlotDef[] = [
  { id: 'lunch', label: '점심', start: '11:30', end: '14:00' },
  { id: 'dinner', label: '저녁', start: '18:00', end: '22:00' },
  { id: 'am', label: '오전 반일', start: '09:00', end: '13:00' },
  { id: 'pm', label: '오후 반일', start: '13:00', end: '18:00' },
  { id: 'allday', label: '종일', start: '09:00', end: '22:00' },
];

export const SLOT_LABEL: Record<SlotKind, string> = {
  lunch: '점심',
  dinner: '저녁',
  am: '오전 반일',
  pm: '오후 반일',
  allday: '종일',
  custom: '직접 선택',
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-4]):([0-5]\d)$/;
const STAMP_RE = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;

export function isDate(s: unknown): s is string {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function isTime(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = TIME_RE.exec(s);
  if (!m) return false;
  return m[1] !== '24' || m[2] === '00';
}

export function isStamp(s: unknown): s is string {
  return typeof s === 'string' && STAMP_RE.test(s) && isDate(s.slice(0, 10));
}

export function timeToMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function minToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0=일요일 … 6=토요일 */
export function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** 날짜 + "HH:MM"(24:00 허용) → 시각 문자열 */
export function stamp(date: string, time: string): string {
  if (time === '24:00') return `${addDays(date, 1)}T00:00`;
  return `${date}T${time}`;
}

/** 지금 한국 날짜와 시각 */
export function nowKst(now: Date = new Date()): { date: string; stamp: string } {
  const k = new Date(now.getTime() + KST_OFFSET_MIN * 60_000);
  const iso = k.toISOString();
  return { date: iso.slice(0, 10), stamp: iso.slice(0, 16) };
}

/** 신청 가능한 날짜 범위: 내일부터 90일 뒤까지 (양 끝 포함) */
export function bookableRange(now: Date = new Date()): { from: string; to: string } {
  const today = nowKst(now).date;
  return { from: addDays(today, 1), to: addDays(today, BOOKABLE_DAYS) };
}

export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export interface Range {
  start: string;
  end: string;
}

export type RangeResult = { ok: true; range: Range } | { ok: false; error: string; message: string };

/** 시간대 또는 직접 선택 시간을 실제 구간으로 바꾼다. */
export function slotRange(date: string, slot: SlotKind, start?: string, end?: string): RangeResult {
  if (!isDate(date)) return { ok: false, error: 'bad_date', message: '날짜 형식이 맞지 않아요' };
  if (slot !== 'custom') {
    const def = SLOTS.find((s) => s.id === slot);
    if (!def) return { ok: false, error: 'bad_slot', message: '없는 시간대예요' };
    return { ok: true, range: { start: stamp(date, def.start), end: stamp(date, def.end) } };
  }
  if (!isTime(start) || !isTime(end)) {
    return { ok: false, error: 'bad_time', message: '시작과 끝 시간을 골라 주세요' };
  }
  const s = timeToMin(start);
  const e = timeToMin(end);
  if (s % STEP_MIN !== 0 || e % STEP_MIN !== 0) {
    return { ok: false, error: 'bad_time', message: '시간은 30분 단위로 골라 주세요' };
  }
  if (s >= 24 * 60) return { ok: false, error: 'bad_time', message: '시작 시간이 맞지 않아요' };
  if (e - s < STEP_MIN) {
    return { ok: false, error: 'bad_time', message: '끝 시간은 시작보다 30분 이상 뒤여야 해요' };
  }
  return { ok: true, range: { start: stamp(date, start), end: stamp(date, end) } };
}

/** 한 날짜에 걸친 부분만 잘라 낸다. 안 걸치면 null */
export function clipToDay(r: Range, date: string): Range | null {
  const dayStart = `${date}T00:00`;
  const dayEnd = `${addDays(date, 1)}T00:00`;
  if (!overlaps(r.start, r.end, dayStart, dayEnd)) return null;
  return { start: r.start < dayStart ? dayStart : r.start, end: r.end > dayEnd ? dayEnd : r.end };
}

export function monthDays(month: string): string[] {
  const first = `${month}-01`;
  const out: string[] = [];
  for (let d = first; d.slice(0, 7) === month; d = addDays(d, 1)) out.push(d);
  return out;
}

export function isMonth(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

export function formatRange(start: string, end: string): string {
  const endTime = end.slice(11) === '00:00' && end.slice(0, 10) > start.slice(0, 10) ? '24:00' : end.slice(11);
  if (end.slice(0, 10) === start.slice(0, 10) || endTime === '24:00') {
    return `${start.slice(0, 10)} ${start.slice(11)}–${endTime}`;
  }
  return `${start.replace('T', ' ')} – ${end.replace('T', ' ')}`;
}
