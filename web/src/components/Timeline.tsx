import type { DayBlock } from '../../../server/domain/availability.js';
import { timeToMin } from '../../../server/domain/time.js';

const FROM = 8 * 60;
const TO = 23 * 60;
const SPAN = TO - FROM;

function pos(stampStr: string, date: string): number {
  const d = stampStr.slice(0, 10);
  const m = d < date ? 0 : d > date ? 24 * 60 : timeToMin(stampStr.slice(11));
  return Math.min(Math.max((m - FROM) / SPAN, 0), 1) * 100;
}

interface Props {
  date: string;
  blocks: DayBlock[];
  /** 고른 구간 (미리 보기) */
  selection?: { start: string; end: string } | null;
  compact?: boolean;
}

/** 08–23시 하루 막대. 불가는 빗금, 예약됨은 회색, 고른 시간은 청록 테두리 */
export function Timeline({ date, blocks, selection, compact }: Props) {
  return (
    <div className={compact ? 'timeline timeline--compact' : 'timeline'} aria-hidden={compact}>
      <div className="timeline__track">
        {blocks.map((b, i) => {
          const left = pos(b.start, date);
          const width = pos(b.end, date) - left;
          if (width <= 0) return null;
          return (
            <span
              key={i}
              className={`timeline__block timeline__block--${b.kind}`}
              style={{ left: `${left}%`, width: `${width}%` }}
              title={compact ? undefined : `${b.kind === 'busy' ? '불가' : '예약됨'} ${b.start.slice(11)}–${b.end.slice(11)}`}
            />
          );
        })}
        {selection && (
          <span
            className="timeline__selection"
            style={{ left: `${pos(selection.start, date)}%`, width: `${pos(selection.end, date) - pos(selection.start, date)}%` }}
          />
        )}
      </div>
      {!compact && (
        <div className="timeline__ticks">
          {[9, 12, 15, 18, 21].map((h) => (
            <span key={h} style={{ left: `${((h * 60 - FROM) / SPAN) * 100}%` }}>
              {h}시
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
