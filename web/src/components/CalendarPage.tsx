import { ChevronLeft, ChevronRight, EyeOff, ListChecks } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { addDays, weekday } from '../../../server/domain/time.js';
import { navigate } from '../App.js';
import { api, local, type CalendarDay, type Config } from '../api.js';
import { monthLabel, shiftMonth } from '../format.js';
import { DayPanel } from './DayPanel.js';
import { Timeline } from './Timeline.js';

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const STATE_LABEL = { free: '여유', partial: '일부 가능', full: '불가', closed: '신청 기간 아님' } as const;

export function CalendarPage({ config }: { config: Config }) {
  const firstMonth = config.bookableFrom.slice(0, 7);
  const lastMonth = config.bookableTo.slice(0, 7);
  const [month, setMonth] = useState(firstMonth);
  const [days, setDays] = useState<CalendarDay[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const hasMine = local.tokens().length > 0;
  // 이 기기에서 신청한 날짜 (신청 중·확정) → 캘린더에 레몬 점
  const [mineDates, setMineDates] = useState<Map<string, 'pending' | 'confirmed'>>(new Map());

  const load = useCallback(() => {
    setError(null);
    api
      .calendar(month)
      .then((r) => setDays(r.days))
      .catch((e: Error) => setError(e.message));
    const tokens = local.tokens();
    if (tokens.length > 0) {
      api
        .mine(tokens)
        .then((r) => {
          const m = new Map<string, 'pending' | 'confirmed'>();
          for (const b of r.bookings) {
            if (b.status === 'pending' || b.status === 'confirmed') {
              const d = b.start.slice(0, 10);
              if (m.get(d) !== 'confirmed') m.set(d, b.status);
            }
          }
          setMineDates(m);
        })
        .catch(() => undefined);
    }
  }, [month]);

  useEffect(() => {
    setDays(null);
    load();
  }, [load]);

  const selectedDay = days?.find((d) => d.date === selected) ?? null;
  // 첫 달은 신청 가능한 날이 있는 주부터 보여 준다 (지난 주들로 화면을 채우지 않게)
  const cutoff = month === firstMonth ? weekStart(config.bookableFrom) : null;
  const shown = (days ?? []).filter((d) => !cutoff || d.date >= cutoff);
  const lead = shown.length ? weekday(shown[0].date) : 0;

  return (
    <div className={selectedDay ? 'layout layout--with-panel' : 'layout'}>
      <main className="page">
        <header className="hero">
          <h1>{config.title}</h1>
          <p className="hero__sub">빈 날짜를 눌러 약속을 신청해 주세요. 확인되면 확정으로 바뀌어요.</p>
          <p className="hero__privacy">
            <EyeOff size={15} aria-hidden /> 일정 내용과 다른 사람 이름은 보이지 않아요
          </p>
          <button className="link-btn" onClick={() => navigate('/mine')}>
            <ListChecks size={18} aria-hidden />
            {hasMine ? '내 신청 보기' : '내 신청 찾기'}
          </button>
        </header>

        <section className="calendar" aria-label="약속 캘린더">
          <div className="calendar__head">
            <button
              className="icon-btn"
              onClick={() => setMonth(shiftMonth(month, -1))}
              disabled={month <= firstMonth}
              aria-label="이전 달"
            >
              <ChevronLeft size={22} />
            </button>
            <h2>{monthLabel(month)}</h2>
            <button
              className="icon-btn"
              onClick={() => setMonth(shiftMonth(month, 1))}
              disabled={month >= lastMonth}
              aria-label="다음 달"
            >
              <ChevronRight size={22} />
            </button>
          </div>

          <ul className="legend" aria-label="표시 안내">
            <li><span className="swatch swatch--free" />여유</li>
            <li><span className="swatch swatch--partial" />일부 가능</li>
            <li><span className="swatch swatch--full" />불가</li>
            <li><span className="swatch swatch--booked" />예약됨</li>
            {mineDates.size > 0 && <li><span className="swatch swatch--mine" />내 신청</li>}
          </ul>

          <div className="grid grid--week" aria-hidden>
            {WEEK.map((w, i) => (
              <span key={w} className={i === 0 ? 'week week--sun' : i === 6 ? 'week week--sat' : 'week'}>
                {w}
              </span>
            ))}
          </div>

          {error ? (
            <div className="notice notice--error" role="alert">
              <p>캘린더를 못 불러왔어요. 잠시 후 다시 시도해 주세요.</p>
              <button className="btn" onClick={load}>다시 시도</button>
            </div>
          ) : (
            <div className="grid grid--days" aria-busy={!days}>
              {Array.from({ length: lead }, (_, i) => (
                <span key={`lead-${i}`} />
              ))}
              {shown.map((d) => {
                const n = Number(d.date.slice(8));
                const disabled = d.state === 'closed' || d.state === 'full';
                const mine = mineDates.get(d.date);
                const isToday = d.date === config.today;
                return (
                  <button
                    key={d.date}
                    className={`day day--${d.state}${selected === d.date ? ' day--selected' : ''}${isToday ? ' day--today' : ''}`}
                    disabled={disabled}
                    onClick={() => setSelected(d.date)}
                    aria-label={`${Number(d.date.slice(5, 7))}월 ${n}일, ${isToday ? '오늘, ' : ''}${STATE_LABEL[d.state]}${mine ? `, 내 신청 ${mine === 'confirmed' ? '확정' : '신청 중'}` : ''}`}
                    aria-pressed={selected === d.date}
                  >
                    <span className="day__top">
                      <span className="day__num">{n}</span>
                      {mine && <span className={`day__mine day__mine--${mine}`} aria-hidden />}
                    </span>
                    {isToday && <span className="day__today">오늘</span>}
                    {d.state !== 'closed' && d.blocks.length > 0 && <Timeline date={d.date} blocks={d.blocks} compact />}
                    {d.state === 'full' && <span className="day__tag">불가</span>}
                  </button>
                );
              })}
            </div>
          )}
          <p className="calendar__foot">
            내일부터 {Number(config.bookableTo.slice(5, 7))}월 {Number(config.bookableTo.slice(8))}일까지 신청할 수 있어요.
          </p>
        </section>
      </main>

      {selectedDay && (
        <DayPanel
          key={selectedDay.date}
          config={config}
          day={selectedDay}
          onClose={() => setSelected(null)}
          onBooked={load}
        />
      )}
    </div>
  );
}

function weekStart(date: string): string {
  return addDays(date, -weekday(date));
}
