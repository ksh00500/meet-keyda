// 날짜별 가능 여부 판정. 서버(캘린더 상태)와 화면(버튼 비활성화)이 같은 규칙을 쓴다.
import { SLOTS, STEP_MIN, type SlotId, clipToDay, minToTime, overlaps, stamp } from './time.js';

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
