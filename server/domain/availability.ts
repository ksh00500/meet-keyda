// 날짜별 가능 여부 판정. 서버(캘린더 상태)와 화면(버튼 비활성화)이 같은 규칙을 쓴다.
import { SLOTS, STEP_MIN, type SlotId, clipToDay, minToTime, overlaps, stamp, timeToMin } from './time.js';

/** 직접 선택으로라도 고를 빈 30분이 있는지 보는 시간 범위 (종일 시간대와 같음) */
const OPEN_FROM = 9 * 60;
const OPEN_TO = 22 * 60;

export type BlockKind = 'busy' | 'booked';

export interface DayBlock {
  start: string;
  end: string;
  kind: BlockKind;
}

export type DayState = 'closed' | 'free' | 'partial' | 'full';

export interface SlotStatus {
  id: SlotId;
  available: boolean;
  /** 막힌 이유. busy가 booked보다 우선 */
  reason: BlockKind | null;
}

export function blockingKind(start: string, end: string, blocks: DayBlock[]): BlockKind | null {
  let found: BlockKind | null = null;
  for (const b of blocks) {
    if (!overlaps(start, end, b.start, b.end)) continue;
    if (b.kind === 'busy') return 'busy';
    found = 'booked';
  }
  return found;
}

export function slotStatuses(date: string, blocks: DayBlock[]): SlotStatus[] {
  return SLOTS.map((s) => {
    const reason = blockingKind(stamp(date, s.start), stamp(date, s.end), blocks);
    return { id: s.id, available: reason === null, reason };
  });
}

export function dayState(date: string, blocks: DayBlock[], inWindow: boolean): DayState {
  if (!inWindow) return 'closed';
  const onDay = blocks.filter((b) => clipToDay(b, date) !== null);
  if (onDay.length === 0) return 'free';
  if (slotStatuses(date, onDay).some((s) => s.available)) return 'partial';
  return hasFreeStep(date, onDay) ? 'partial' : 'full';
}

/** 09–22시 안에 직접 선택할 수 있는 빈 30분이 하나라도 있는지 */
export function hasFreeStep(date: string, blocks: DayBlock[]): boolean {
  for (let m = OPEN_FROM; m < OPEN_TO; m += STEP_MIN) {
    if (!blockingKind(stamp(date, minToTime(m)), stamp(date, minToTime(m + STEP_MIN)), blocks)) return true;
  }
  return false;
}

/** 캘린더 칸에 보여 줄 하루 세 구간 */
export const PERIODS = [
  { id: 'am', label: '오전', start: '09:00', end: '13:00' },
  { id: 'pm', label: '오후', start: '13:00', end: '18:00' },
  { id: 'eve', label: '저녁', start: '18:00', end: '22:00' },
] as const;

/** free: 전부 비어 있음, some: 30분 이상 빈 시간이 있음, busy/booked: 빈 시간 없음(막은 이유) */
export type PeriodState = 'free' | 'some' | BlockKind;

export function periodStates(date: string, blocks: DayBlock[]): PeriodState[] {
  return PERIODS.map((p) => {
    const start = timeToMin(p.start);
    const end = timeToMin(p.end);
    let freeSteps = 0;
    let total = 0;
    let reason: BlockKind | null = null;
    for (let m = start; m < end; m += STEP_MIN) {
      total++;
      const k = blockingKind(stamp(date, minToTime(m)), stamp(date, minToTime(m + STEP_MIN)), blocks);
      if (!k) freeSteps++;
      else if (k === 'busy' || !reason) reason = k;
    }
    if (freeSteps === total) return 'free';
    if (freeSteps > 0) return 'some';
    return reason ?? 'busy';
  });
}

/** 칸에 쓸 짧은 요약. 예: "종일 가능", "저녁 가능", "오전·오후 가능" */
export function daySummary(states: PeriodState[]): string {
  const openIdx = states.map((s, i) => (s === 'free' || s === 'some' ? i : -1)).filter((i) => i >= 0);
  if (openIdx.length === 0) return '불가';
  const allFree = openIdx.every((i) => states[i] === 'free');
  if (openIdx.length === 3) return allFree ? '종일 가능' : '일부 시간 가능';
  const names = openIdx.map((i) => PERIODS[i].label).join('·');
  // 빈 구간이 전부 '조금만' 비어 있으면 그렇게 말한다. 예: 저녁 18–19시만 빔 → "저녁 일부 가능"
  if (openIdx.every((i) => states[i] === 'some')) return `${names} 일부 가능`;
  return allFree ? `${names} 가능` : '일부 시간 가능';
}

