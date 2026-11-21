// 날짜별 가능 여부 판정. 서버(캘린더 상태)와 화면(버튼 비활성화)이 같은 규칙을 쓴다.
import { SLOTS, type SlotId, clipToDay, overlaps, stamp } from './time.js';

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
  return slotStatuses(date, onDay).some((s) => s.available) ? 'partial' : 'full';
}
