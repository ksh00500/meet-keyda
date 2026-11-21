import type { DayBlock } from '../../../server/domain/availability.js';
import { STEP_MIN, minToTime, timeToMin } from '../../../server/domain/time.js';

export const DEFAULT_FROM = 8 * 60;
export const DEFAULT_TO = 23 * 60;
const LABEL = { busy: '불가', booked: '예약됨' } as const;

/** 시각 문자열 → 그날 0시부터 분 (전날이면 0, 다음 날이면 1440) */
function dayMin(stampStr: string, date: string): number {
  const d = stampStr.slice(0, 10);
  if (d < date) return 0;
  if (d > date) return 24 * 60;
  return timeToMin(stampStr.slice(11));
}

interface Seg {
  from: number;
  to: number;
}

/** 보이는 범위 안의 빈 구간 (30분 이상) */
export function freeGaps(date: string, blocks: DayBlock[], from: number, to: number): Seg[] {
  const busy = blocks
    .map((b) => ({ from: Math.max(dayMin(b.start, date), from), to: Math.min(dayMin(b.end, date), to) }))
    .filter((s) => s.to > s.from)
    .sort((a, b) => a.from - b.from);
  const gaps: Seg[] = [];
  let cur = from;
  for (const s of busy) {
    if (s.from - cur >= STEP_MIN) gaps.push({ from: cur, to: s.from });
    cur = Math.max(cur, s.to);
  }
  if (to - cur >= STEP_MIN) gaps.push({ from: cur, to });
  // 30분 단위로 맞춘다
  return gaps
    .map((g) => ({ from: Math.ceil(g.from / STEP_MIN) * STEP_MIN, to: Math.floor(g.to / STEP_MIN) * STEP_MIN }))
    .filter((g) => g.to - g.from >= STEP_MIN);
}

interface Props {
  date: string;
  blocks: DayBlock[];
  /** 고른 구간 (미리 보기) */
  selection?: { start: string; end: string } | null;
  compact?: boolean;
  /** 주간 보기용 한 줄 막대 (눈금 선과 구간 글자만) */
  row?: boolean;
  /** 빈 곳을 눌렀을 때: 시작·끝 "HH:MM" */
  onPick?: (start: string, end: string) => void;
}

/** 하루 시간 막대. 불가는 빗금, 예약됨은 회색, 빈 시간은 눌러서 고를 수 있다 */
export function Timeline({ date, blocks, selection, compact, row, onPick }: Props) {
  const selFrom = selection ? dayMin(selection.start, date) : null;
  const selTo = selection ? dayMin(selection.end, date) : null;
  const from = compact ? DEFAULT_FROM : Math.min(DEFAULT_FROM, selFrom ?? DEFAULT_FROM);
  const to = compact ? DEFAULT_TO : Math.max(DEFAULT_TO, selTo ?? DEFAULT_TO);
  const span = to - from;
  const pct = (m: number) => (Math.min(Math.max(m - from, 0), span) / span) * 100;

  const segs = blocks
    .map((b) => ({ kind: b.kind, from: dayMin(b.start, date), to: dayMin(b.end, date) }))
    .filter((s) => s.to > from && s.from < to);

  if (compact) {
    return (
      <div className="timeline timeline--compact" aria-hidden>
        <div className="timeline__track">
          {segs.map((s, i) => (
            <span
              key={i}
              className={`timeline__block timeline__block--${s.kind}`}
              style={{ left: `${pct(s.from)}%`, width: `${pct(s.to) - pct(s.from)}%` }}
            />
          ))}
        </div>
      </div>
    );
  }

  const gaps = freeGaps(date, blocks, from, to);
  const hours: number[] = [];
  for (let h = Math.ceil(from / 60); h * 60 <= to; h++) hours.push(h);

  if (row) {
    return (
      <div className="timeline timeline--row" aria-hidden>
        <div className="timeline__track">
          {hours.map((h) => (
            <span key={h} className={`timeline__grid${h % 3 === 0 ? ' timeline__grid--major' : ''}`} style={{ left: `${pct(h * 60)}%` }} />
          ))}
          {segs.map((s, i) => {
            const w = pct(s.to) - pct(s.from);
            return (
              <span key={i} className={`timeline__block timeline__block--${s.kind}`} style={{ left: `${pct(s.from)}%`, width: `${w}%` }}>
                {w >= 18 && <span className="timeline__label">{LABEL[s.kind]}</span>}
              </span>
            );
          })}
        </div>
      </div>
    );
  }

  const pickAt = (gap: Seg, clientX: number, rect: DOMRect) => {
    if (!onPick) return;
    const m = from + ((clientX - rect.left) / rect.width) * span;
    const start = Math.min(Math.max(Math.round(m / STEP_MIN) * STEP_MIN, gap.from), gap.to - STEP_MIN);
    const end = Math.min(start + 60, gap.to);
    onPick(minToTime(start), minToTime(end));
  };

  return (
    <div className="timeline">
      {selection && selFrom !== null && selTo !== null && (
        <div className="timeline__sel-labels" aria-hidden>
          {/* 고른 구간 가운데에 시간 하나로. 막대 밖으로 나가지 않게 12%~88% 안에 둔다 */}
          <span style={{ left: `${Math.min(Math.max((pct(selFrom) + pct(selTo)) / 2, 12), 88)}%` }}>
            {minToTime(selFrom)}–{minToTime(selTo)}
          </span>
        </div>
      )}
      <div
        className="timeline__track"
        aria-hidden
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const m = from + ((e.clientX - rect.left) / rect.width) * span;
          const gap = gaps.find((g) => m >= g.from && m < g.to);
          if (gap) pickAt(gap, e.clientX, rect);
        }}
      >
        {hours.map((h) => (
          <span key={h} className={`timeline__grid${h % 3 === 0 ? ' timeline__grid--major' : ''}`} style={{ left: `${pct(h * 60)}%` }} />
        ))}
        {onPick &&
          gaps.map((g) => (
            <span
              key={`g${g.from}`}
              className="timeline__free"
              style={{ left: `${pct(g.from)}%`, width: `${pct(g.to) - pct(g.from)}%` }}
            />
          ))}
        {segs.map((s, i) => {
          const w = pct(s.to) - pct(s.from);
          return (
            <span
              key={i}
              className={`timeline__block timeline__block--${s.kind}`}
              style={{ left: `${pct(s.from)}%`, width: `${w}%` }}
            >
              {w >= 14 && <span className="timeline__label">{LABEL[s.kind]}</span>}
            </span>
          );
        })}
        {selFrom !== null && selTo !== null && (
          <span className="timeline__selection" style={{ left: `${pct(selFrom)}%`, width: `${pct(selTo) - pct(selFrom)}%` }} />
        )}
      </div>
      <div className="timeline__ticks" aria-hidden>
        {hours
          .filter((h) => h % 3 === 0)
          .map((h) => (
            <span key={h} style={{ left: `${pct(h * 60)}%` }}>
              {h}시
            </span>
          ))}
      </div>

      <div className="free-list">
        <span className="free-list__title">빈 시간</span>
        {gaps.length === 0 ? (
          <span className="free-list__none">이날은 빈 시간이 없어요</span>
        ) : (
          gaps.map((g) => {
            const label = `${minToTime(g.from)}–${minToTime(g.to)}`;
            return onPick ? (
              <button
                key={g.from}
                type="button"
                className="free-pill"
                onClick={() => onPick(minToTime(g.from), minToTime(Math.min(g.from + 60, g.to)))}
                aria-label={`${label} 빈 시간에서 고르기`}
              >
                {label}
              </button>
            ) : (
              <span key={g.from} className="free-pill free-pill--static">
                {label}
              </span>
            );
          })
        )}
      </div>
    </div>
  );
}
