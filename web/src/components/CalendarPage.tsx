import { CalendarDays, CalendarRange, ChevronLeft, ChevronRight, EyeOff, ListChecks } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PERIODS, daySummary, periodStates } from '../../../server/domain/availability.js';
import { addDays, weekday } from '../../../server/domain/time.js';
import { navigate } from '../App.js';
import { api, local, type CalendarDay, type Config } from '../api.js';
import { monthLabel, shiftMonth } from '../format.js';
import { DayPanel } from './DayPanel.js';
import { DEFAULT_FROM, DEFAULT_TO, Timeline } from './Timeline.js';

const WEEK = ['일', '월', '화', '수', '목', '금', '토']; // weekday() 순서(0=일)로 찾는 이름표
// 한국식으로 월요일부터 시작
const HEADER_ORDER = [1, 2, 3, 4, 5, 6, 0];
const mondayIndex = (date: string) => (weekday(date) + 6) % 7;
const CLOSED_LABEL = '신청 기간 아님';
type View = 'month' | 'week';
type Mine = Map<string, 'pending' | 'confirmed'>;

const VIEW_KEY = 'meet.view';
function savedView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === 'month' || v === 'week') return v;
  } catch {
    /* 저장소를 못 써도 기본값 */
  }
  return 'month';
}

/** 그 날짜가 속한 주의 월요일 */
function weekStart(date: string): string {
  return addDays(date, -mondayIndex(date));
}

export function CalendarPage({ config }: { config: Config }) {
  const firstMonth = config.bookableFrom.slice(0, 7);
  const lastMonth = config.bookableTo < config.bookableFrom ? config.bookableFrom.slice(0, 7) : config.bookableTo.slice(0, 7);
  const firstWeek = weekStart(config.bookableFrom);
  const lastWeek = weekStart(config.bookableTo < config.bookableFrom ? config.bookableFrom : config.bookableTo);

  const [view, setViewState] = useState<View>(savedView);
  const [month, setMonth] = useState(firstMonth);
  // 첫 주에 신청 가능한 날이 1–2일뿐이면(예: 토요일에 접속) 다음 주부터 보여 준다. 이전 주 버튼으로 돌아갈 수 있다
  const startWeek = addDays(firstWeek, 7) <= addDays(config.bookableFrom, 2) && firstWeek < lastWeek ? addDays(firstWeek, 7) : firstWeek;
  const [week, setWeek] = useState(startWeek);
  const [cache, setCache] = useState<Record<string, CalendarDay[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [mineDates, setMineDates] = useState<Mine>(new Map());
  const hasMine = local.tokens().length > 0;

  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* 무시 */
    }
    // 보던 위치를 이어서: 월간 → 그 달의 첫 신청 가능 주, 주간 → 그 주의 달
    if (v === 'week') {
      const start = month === firstMonth ? startWeek : weekStart(`${month}-01`);
      setWeek(start < firstWeek ? firstWeek : start > lastWeek ? lastWeek : start);
    } else {
      const m = addDays(week, 3).slice(0, 7);
      setMonth(m < firstMonth ? firstMonth : m > lastMonth ? lastMonth : m);
    }
  };

  // 지금 화면에 필요한 달 (주간은 두 달에 걸칠 수 있음)
  const neededMonths = useMemo(() => {
    if (view === 'month') return [month];
    const a = week.slice(0, 7);
    const b = addDays(week, 6).slice(0, 7);
    return a === b ? [a] : [a, b];
  }, [view, month, week]);

  const loaded = useRef(new Set<string>());
  const loadMonths = useCallback((months: string[], force = false) => {
    setError(null);
    for (const m of months) {
      if (!force && loaded.current.has(m)) continue;
      loaded.current.add(m);
      api
        .calendar(m)
        .then((r) => setCache((c) => ({ ...c, [m]: r.days })))
        .catch((e: Error) => {
          loaded.current.delete(m);
          setError(e.message);
        });
    }
  }, []);

  const loadMine = useCallback(() => {
    const tokens = local.tokens();
    if (tokens.length === 0) return;
    api
      .mine(tokens)
      .then((r) => {
        const m: Mine = new Map();
        for (const b of r.bookings) {
          if (b.status === 'pending' || b.status === 'confirmed') {
            const d = b.start.slice(0, 10);
            if (m.get(d) !== 'confirmed') m.set(d, b.status);
          }
        }
        setMineDates(m);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    loadMonths(neededMonths);
  }, [neededMonths, loadMonths]);
  useEffect(loadMine, [loadMine]);

  // 신청 뒤 새로 불러오기. 캐시를 비우지 않아야 열린 날짜 창이 닫히지 않는다
  const refresh = () => {
    loaded.current.clear();
    loadMonths(neededMonths, true);
    loadMine();
  };

  const byDate = useMemo(() => {
    const m = new Map<string, CalendarDay>();
    for (const days of Object.values(cache)) for (const d of days) m.set(d.date, d);
    return m;
  }, [cache]);

  const selectedDay = selected ? byDate.get(selected) ?? null : null;
  const ready = neededMonths.every((m) => cache[m]);

  // 월간: 첫 달은 신청 가능한 날이 있는 주부터
  const monthDaysShown = (cache[month] ?? []).filter((d) => month !== firstMonth || d.date >= firstWeek);
  const lead = monthDaysShown.length ? mondayIndex(monthDaysShown[0].date) : 0;
  // 주간: 첫 주의 지난 날짜(오늘 포함)는 줄을 만들지 않는다
  const weekDays = Array.from({ length: 7 }, (_, i) => byDate.get(addDays(week, i))).filter(
    (d): d is CalendarDay => !!d && d.date >= config.bookableFrom,
  );

  // 주간 제목은 보이는 첫 날부터 (첫 주는 지난 날을 숨기므로)
  const wFrom = week < config.bookableFrom ? config.bookableFrom : week;
  const wTo = addDays(week, 6);
  const title =
    view === 'month'
      ? monthLabel(month)
      : wFrom === wTo
        ? `${Number(wFrom.slice(5, 7))}월 ${Number(wFrom.slice(8))}일`
        : `${Number(wFrom.slice(5, 7))}월 ${Number(wFrom.slice(8))}일 – ${
            wTo.slice(5, 7) === wFrom.slice(5, 7) ? '' : `${Number(wTo.slice(5, 7))}월 `
          }${Number(wTo.slice(8))}일`;
  const canPrev = view === 'month' ? month > firstMonth : week > firstWeek;
  const canNext = view === 'month' ? month < lastMonth : week < lastWeek;
  const go = (delta: number) =>
    view === 'month' ? setMonth(shiftMonth(month, delta)) : setWeek(addDays(week, 7 * delta));

  const dayInfo = (d: CalendarDay) => {
    const n = Number(d.date.slice(8));
    const mine = mineDates.get(d.date);
    const isToday = d.date === config.today;
    const periods = periodStates(d.date, d.blocks);
    // 꽉 찬 날: 내 일정 때문이면 "불가", 다른 신청 때문이면 "예약 마감"
    const fullByBooking = d.state === 'full' && periods.every((p) => p === 'booked');
    const summary = d.state === 'full' ? (fullByBooking ? '예약 마감' : '불가') : daySummary(periods);
    const disabled = d.state === 'closed' || d.state === 'full';
    const label = `${Number(d.date.slice(5, 7))}월 ${n}일 ${WEEK[weekday(d.date)]}요일, ${isToday ? '오늘, ' : ''}${
      d.state === 'closed' ? CLOSED_LABEL : summary
    }${mine ? `, 내 신청 ${mine === 'confirmed' ? '확정' : '신청 중'}` : ''}`;
    return { n, mine, isToday, periods, summary, disabled, label, fullByBooking };
  };

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
          <div className="calendar__bar">
            <div className="segmented" role="tablist" aria-label="보기 방식">
              <button role="tab" aria-selected={view === 'month'} onClick={() => setView('month')}>
                <CalendarDays size={16} aria-hidden /> 월간
              </button>
              <button role="tab" aria-selected={view === 'week'} onClick={() => setView('week')}>
                <CalendarRange size={16} aria-hidden /> 주간
              </button>
            </div>
          </div>

          <div className="calendar__head">
            <button className="icon-btn" onClick={() => go(-1)} disabled={!canPrev} aria-label={view === 'month' ? '이전 달' : '이전 주'}>
              <ChevronLeft size={22} />
            </button>
            <h2 aria-live="polite">{title}</h2>
            <button className="icon-btn" onClick={() => go(1)} disabled={!canNext} aria-label={view === 'month' ? '다음 달' : '다음 주'}>
              <ChevronRight size={22} />
            </button>
          </div>

          {view === 'month' ? (
            <div className="legend" aria-label="표시 안내">
              <div className="legend__map">
                <span className="legend__cell" aria-hidden>
                  <span className="legend__num">12</span>
                  <span className="segs">
                    <i className="seg seg--free" />
                    <i className="seg seg--free" />
                    <i className="seg seg--free" />
                  </span>
                </span>
                <ol className="legend__periods">
                  {PERIODS.map((p) => (
                    <li key={p.id}>
                      <b>{p.label}</b> {Number(p.start.slice(0, 2))}–{Number(p.end.slice(0, 2))}시
                    </li>
                  ))}
                </ol>
              </div>
              <Keys mine={mineDates.size > 0} />
            </div>
          ) : (
            <div className="legend" aria-label="표시 안내">
              <span className="legend__text">막대는 하루 8시–23시예요. 빈 곳이 약속 가능한 시간이에요.</span>
              <Keys mine={mineDates.size > 0} week />
            </div>
          )}

          {error ? (
            <div className="notice notice--error" role="alert">
              <p>캘린더를 못 불러왔어요. 잠시 후 다시 시도해 주세요.</p>
              <button className="btn" onClick={refresh}>
                다시 시도
              </button>
            </div>
          ) : view === 'month' ? (
            <>
              <div className="grid grid--week" aria-hidden>
                {HEADER_ORDER.map((i) => (
                  <span key={i} className={i === 0 ? 'week week--sun' : i === 6 ? 'week week--sat' : 'week'}>
                    {WEEK[i]}
                  </span>
                ))}
              </div>
              <div className="grid grid--days" aria-busy={!ready}>
                {Array.from({ length: lead }, (_, i) => (
                  <span key={`lead-${i}`} />
                ))}
                {monthDaysShown.map((d) => {
                  const x = dayInfo(d);
                  return (
                    <button
                      key={d.date}
                      className={`day day--${d.state}${x.fullByBooking ? ' day--booked-out' : ''}${selected === d.date ? ' day--selected' : ''}`}
                      disabled={x.disabled}
                      onClick={() => setSelected(d.date)}
                      aria-label={x.label}
                      aria-pressed={selected === d.date}
                    >
                      <span className="day__top">
                        <span className="day__num">{x.n}</span>
                        {x.mine && <span className={`dot dot--${x.mine}`} aria-hidden />}
                      </span>
                      {x.isToday ? (
                        <span className="day__note day__note--today">오늘</span>
                      ) : d.state !== 'closed' ? (
                        <span className={`day__note${d.state === 'full' ? ' day__note--full' : ''}`}>
                          {x.fullByBooking ? (
                            <>
                              <span className="only-wide">예약 마감</span>
                              <span className="only-narrow">마감</span>
                            </>
                          ) : (
                            x.summary
                          )}
                        </span>
                      ) : null}
                      {d.state !== 'closed' && (
                        <span className="segs" aria-hidden>
                          {x.periods.map((p, i) => (
                            <i key={i} className={`seg seg--${p}`} />
                          ))}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="weekview" aria-busy={!ready}>
              <div className="wrow wrow--scale" aria-hidden>
                <span />
                <span className="wscale">
                  {[9, 12, 15, 18, 21].map((h) => (
                    <span key={h} style={{ left: `${((h * 60 - DEFAULT_FROM) / (DEFAULT_TO - DEFAULT_FROM)) * 100}%` }}>
                      {h}시
                    </span>
                  ))}
                </span>
              </div>
              {weekDays.map((d) => {
                const x = dayInfo(d);
                const wd = weekday(d.date);
                return (
                  <button
                    key={d.date}
                    className={`wrow wrow--${d.state}${x.fullByBooking ? ' wrow--booked-out' : ''}${selected === d.date ? ' wrow--selected' : ''}`}
                    disabled={x.disabled}
                    onClick={() => setSelected(d.date)}
                    aria-label={x.label}
                    aria-pressed={selected === d.date}
                  >
                    <span className={`wdate${wd === 0 ? ' wdate--sun' : wd === 6 ? ' wdate--sat' : ''}`}>
                      <b>{x.n}</b>
                      <small>{WEEK[wd]}</small>
                    </span>
                    <span className="wbody">
                      <span className="wnote">
                        {x.mine && <span className={`dot dot--${x.mine}`} aria-hidden />}
                        {d.state === 'closed' ? (x.isToday ? '오늘' : CLOSED_LABEL) : x.isToday ? '오늘' : x.summary}
                      </span>
                      {d.state !== 'closed' && <Timeline date={d.date} blocks={d.blocks} row />}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <p className="calendar__foot">
            {config.bookableTo < config.bookableFrom
              ? '지금은 새 약속 신청을 받지 않아요.'
              : `내일부터 ${Number(config.bookableTo.slice(5, 7))}월 ${Number(config.bookableTo.slice(8))}일까지 신청할 수 있어요.`}
          </p>
        </section>
      </main>

      {selectedDay && (
        <DayPanel
          key={selectedDay.date}
          config={config}
          day={selectedDay}
          onClose={() => setSelected(null)}
          onBooked={refresh}
        />
      )}
    </div>
  );
}

function Keys({ mine, week }: { mine: boolean; week?: boolean }) {
  return (
    <span className="legend__keys">
      {!week && (
        <>
          <span>
            <i className="seg seg--free" aria-hidden />
            가능
          </span>
          <span>
            <i className="seg seg--some" aria-hidden />
            일부 가능
          </span>
        </>
      )}
      {week && (
        <span>
          <i className="seg seg--blank" aria-hidden />
          가능
        </span>
      )}
      <span>
        <i className="seg seg--busy" aria-hidden />
        불가
      </span>
      <span>
        <i className="seg seg--booked" aria-hidden />
        예약됨
      </span>
      {mine && (
        <span>
          <i className="dot dot--pending" aria-hidden />내 신청
        </span>
      )}
    </span>
  );
}
