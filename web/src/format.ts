import { SLOT_LABEL, type SlotKind, weekday } from '../../server/domain/time.js';
import type { BookingStatus } from './api.js';

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

export function dateLabel(date: string, withYear = false): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${withYear ? `${y}년 ` : ''}${m}월 ${d}일 (${WEEK[weekday(date)]})`;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${y}년 ${m}월`;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

/** "2026-12-02T18:00" ~ "2026-12-02T22:00" → "18:00–22:00" (자정은 24:00) */
export function timeRange(start: string, end: string): string {
  const sd = start.slice(0, 10);
  const ed = end.slice(0, 10);
  const st = start.slice(11);
  const et = end.slice(11);
  if (sd === ed) return `${st}–${et}`;
  if (et === '00:00' && ed === addOneDay(sd)) return st === '00:00' ? '하루 종일' : `${st}–24:00`;
  return `${dateLabel(sd)} ${st} – ${dateLabel(ed)} ${et}`;
}

function addOneDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** "12월 2일 (수) · 18:00–22:00". 여러 날에 걸치면 시작·끝을 모두 */
export function whenLabel(start: string, end: string): string {
  const t = timeRange(start, end);
  return t.includes(' – ') ? t : `${dateLabel(start.slice(0, 10))} · ${t}`;
}

/** 목록에서 날짜와 시간을 두 줄로 보여 줄 때 */
export function whenParts(start: string, end: string): { date: string; time: string } {
  const t = timeRange(start, end);
  if (t.includes(' – ')) return { date: `${dateLabel(start.slice(0, 10))}부터`, time: `${dateLabel(end.slice(0, 10))} ${end.slice(11)}까지` };
  return { date: dateLabel(start.slice(0, 10)), time: t };
}

export const slotLabel = (slot: SlotKind) => SLOT_LABEL[slot] ?? slot;

export const STATUS_LABEL: Record<BookingStatus, string> = {
  pending: '신청 중',
  confirmed: '확정',
  rejected: '거절',
  cancelled: '취소됨',
};
