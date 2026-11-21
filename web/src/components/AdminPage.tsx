import { ArrowLeft, ChevronLeft, ChevronRight, LogOut, Plus, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DayBlock } from '../../../server/domain/availability.js';
import { STEP_MIN, addDays, minToTime, nowKst, stamp, weekday } from '../../../server/domain/time.js';
import { navigate } from '../App.js';
import {
  ApiError,
  api,
  type BookingStatus,
  type Config,
  type OwnerBooking,
  type OwnerDay,
  type Settings,
} from '../api.js';
import { STATUS_LABEL, dateLabel, monthLabel, shiftMonth, slotLabel, timeRange, whenLabel, whenParts } from '../format.js';
import { Timeline } from './Timeline.js';

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const HEADER_ORDER = [1, 2, 3, 4, 5, 6, 0];
const TIMES = Array.from({ length: (24 * 60) / STEP_MIN + 1 }, (_, i) => minToTime(i * STEP_MIN));
type Tab = 'calendar' | 'requests' | 'settings';

/** 로그인 확인 → 로그인 화면 또는 관리자 화면 */
export function AdminPage({ config }: { config: Config }) {
  const [state, setState] = useState<'checking' | 'out' | 'in'>('checking');
  useEffect(() => {
    document.title = '관리자 · ' + config.title;
    api.admin
      .me()
      .then(() => setState('in'))
      .catch(() => setState('out'));
  }, [config.title]);

  if (state === 'checking') return <main className="page" aria-busy="true" />;
  if (state === 'out') return <Login onDone={() => setState('in')} />;
  return <AdminApp config={config} onLogout={() => setState('out')} />;
}

function Login({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <main className="page page--narrow">
      <button className="link-btn" onClick={() => navigate('/')}>
        <ArrowLeft size={18} aria-hidden /> 친구 화면으로
      </button>
      <h1 className="page-title">관리자</h1>
      <form
        className="card form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api.admin.login(pw);
            onDone();
          } catch (err) {
            setError(err instanceof ApiError ? err.message : '잠시 후 다시 시도해 주세요');
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          <span>비밀번호</span>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required />
          <small>서버 .env의 ADMIN_PASSWORD예요. 로그인하면 이 브라우저에 30일 동안 기억해요.</small>
        </label>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn--primary btn--tall" disabled={busy || !pw}>
          {busy ? '확인하는 중…' : '들어가기'}
        </button>
      </form>
    </main>
  );
}

function AdminApp({ config, onLogout }: { config: Config; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>('calendar');
  const [pending, setPending] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handle = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) return onLogout();
      setError(err instanceof Error ? err.message : '잠시 후 다시 시도해 주세요');
    },
    [onLogout],
  );

  const refreshSummary = useCallback(() => {
    api.admin
      .summary()
      .then((s) => {
        setPending(s.pendingCount);
        document.title = `${s.pendingCount > 0 ? `(${s.pendingCount}) ` : ''}관리자 · ${config.title}`;
      })
      .catch(handle);
  }, [config.title, handle]);
  useEffect(refreshSummary, [refreshSummary]);

  const ctx: Ctx = {
    config,
    notify: (m) => {
      setError(null);
      setNotice(m);
    },
    fail: handle,
    changed: refreshSummary,
  };

  return (
    <main className="page page--admin">
      <div className="owner-head">
        <button className="link-btn" onClick={() => navigate('/')}>
          <ArrowLeft size={18} aria-hidden /> 친구 화면 보기
        </button>
        <button
          className="link-btn"
          onClick={async () => {
            await api.admin.logout().catch(() => undefined);
            onLogout();
          }}
        >
          <LogOut size={18} aria-hidden /> 로그아웃
        </button>
      </div>
      <h1 className="page-title">
        관리자{' '}
        {pending > 0 && (
          <button className="pending-pill" onClick={() => setTab('requests')}>
            새 신청 {pending}건
          </button>
        )}
      </h1>

      <div className="tabs" role="tablist">
        {(
          [
            ['calendar', '캘린더'],
            ['requests', '신청'],
            ['settings', '설정'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className="tab" onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {notice && (
        <p className="notice" role="status">
          {notice}
          <button className="icon-btn" onClick={() => setNotice(null)} aria-label="알림 닫기">
            <X size={18} />
          </button>
        </p>
      )}
      {error && (
        <div className="notice notice--error" role="alert">
          <p>{error}</p>
          <button className="icon-btn" onClick={() => setError(null)} aria-label="오류 닫기">
            <X size={18} />
          </button>
        </div>
      )}

      {tab === 'calendar' && <AdminCalendar ctx={ctx} />}
      {tab === 'requests' && <Requests ctx={ctx} />}
      {tab === 'settings' && <SettingsTab ctx={ctx} />}
    </main>
  );
}

interface Ctx {
  config: Config;
  notify: (msg: string) => void;
  fail: (err: unknown) => void;
  changed: () => void;
}

// ---------------- 캘린더 ----------------

function AdminCalendar({ ctx }: { ctx: Ctx }) {
  const today = nowKst().date;
  const [month, setMonth] = useState(today.slice(0, 7));
  const [days, setDays] = useState<OwnerDay[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(() => {
    api.admin
      .calendar(month)
      .then((r) => setDays(r.days))
      .catch(ctx.fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);
  useEffect(load, [load]);

  const lead = days?.length ? (weekday(days[0].date) + 6) % 7 : 0;
  const day = days?.find((d) => d.date === selected) ?? null;

  return (
    <div className={day ? 'admin-cal admin-cal--with-panel' : 'admin-cal'}>
      <section className="calendar">
        <div className="calendar__head">
          <button className="icon-btn" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="이전 달">
            <ChevronLeft size={22} />
          </button>
          <h2>{monthLabel(month)}</h2>
          <button className="icon-btn" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="다음 달">
            <ChevronRight size={22} />
          </button>
        </div>
        <p className="legend">
          <span className="legend__keys">
            <span>
              <i className="aitem-dot aitem-dot--busy" aria-hidden />내 일정
            </span>
            <span>
              <i className="aitem-dot aitem-dot--pending" aria-hidden />
              신청 중
            </span>
            <span>
              <i className="aitem-dot aitem-dot--confirmed" aria-hidden />
              확정
            </span>
          </span>
        </p>
        <div className="grid grid--week" aria-hidden>
          {HEADER_ORDER.map((i) => (
            <span key={i} className={i === 0 ? 'week week--sun' : i === 6 ? 'week week--sat' : 'week'}>
              {WEEK[i]}
            </span>
          ))}
        </div>
        <div className="grid grid--days" aria-busy={!days}>
          {Array.from({ length: lead }, (_, i) => (
            <span key={`l${i}`} />
          ))}
          {(days ?? []).map((d) => {
            const items = dayItems(d);
            const past = d.date < today;
            return (
              <button
                key={d.date}
                className={`aday${past ? ' aday--past' : ''}${d.date === today ? ' aday--today' : ''}${selected === d.date ? ' aday--selected' : ''}`}
                onClick={() => setSelected(d.date)}
                aria-label={`${dateLabel(d.date)}, 내 일정 ${d.busy.length}개, 신청 ${d.bookings.length}개`}
              >
                <span className="aday__num">{Number(d.date.slice(8))}</span>
                <span className="aday__items" aria-hidden>
                  {items.slice(0, 3).map((it) => (
                    <span key={it.key} className={`aitem aitem--${it.kind}`}>
                      <span className="aitem__time">{it.time}</span> {it.text}
                    </span>
                  ))}
                  {items.length > 3 && <span className="aitem aitem--more">+{items.length - 3}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {day && (
        <AdminDayPanel
          key={day.date}
          day={day}
          ctx={ctx}
          onClose={() => setSelected(null)}
          onChanged={() => {
            load();
            ctx.changed();
          }}
        />
      )}
    </div>
  );
}

function dayItems(d: OwnerDay) {
  const items = [
    ...d.busy.map((b) => ({
      key: b.id,
      kind: 'busy',
      sort: b.start < `${d.date}T00:00` ? `${d.date}T00:00` : b.start,
      time: b.start.slice(0, 10) === d.date ? b.start.slice(11) : '~',
      text: b.title || '일정',
    })),
    ...d.bookings.map((b) => ({
      key: b.id,
      kind: b.status,
      sort: b.start,
      time: b.start.slice(11),
      text: b.name,
    })),
  ];
  return items.sort((a, b) => (a.sort < b.sort ? -1 : 1));
}

function AdminDayPanel({
  day,
  ctx,
  onClose,
  onChanged,
}: {
  day: OwnerDay;
  ctx: Ctx;
  onClose: () => void;
  onChanged: () => void;
}) {
  const blocks: DayBlock[] = useMemo(
    () => [
      ...day.busy.map((b) => ({ start: b.start, end: b.end, kind: 'busy' as const })),
      ...day.bookings.map((b) => ({ start: b.start, end: b.end, kind: 'booked' as const })),
    ],
    [day],
  );
  const [working, setWorking] = useState<string | null>(null);

  async function run(id: string, fn: () => Promise<string | void>) {
    setWorking(id);
    try {
      const m = await fn();
      if (m) ctx.notify(m);
      onChanged();
    } catch (err) {
      ctx.fail(err);
    } finally {
      setWorking(null);
    }
  }

  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden />
      <aside className="panel" role="dialog" aria-modal="true" aria-labelledby="admin-day-title">
        <div className="panel__grip" aria-hidden />
        <div className="panel__head">
          <span className="panel__spacer" />
          <div className="panel__title">
            <h2 id="admin-day-title">{dateLabel(day.date, true)}</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">
            <X size={22} />
          </button>
        </div>
        <Timeline date={day.date} blocks={blocks} row />

        <h3 className="section-title section-title--sm">이날 일정과 신청</h3>
        {day.busy.length + day.bookings.length === 0 && <p className="muted">아무것도 없어요.</p>}
        <ul className="alist">
          {day.busy.map((b) => (
            <li key={b.id} className="alist__item alist__item--busy">
              <div>
                <p className="alist__when">{timeRange(b.start, b.end)}</p>
                <p className="alist__what">
                  {b.title || '제목 없음'} {b.seriesId && <span className="badge badge--series">반복</span>}
                </p>
              </div>
              <div className="row">
                <button
                  className="icon-btn"
                  disabled={working === b.id}
                  aria-label="이 일정 지우기"
                  onClick={() =>
                    run(b.id, async () => {
                      if (!window.confirm(`${whenLabel(b.start, b.end)} "${b.title || '일정'}"을(를) 지울까요?`)) return;
                      await api.admin.removeBusy(b.id);
                      return '일정을 지웠어요.';
                    })
                  }
                >
                  <Trash2 size={18} />
                </button>
                {b.seriesId && (
                  <button
                    className="btn btn--quiet btn--small"
                    disabled={working === b.id}
                    onClick={() =>
                      run(b.id, async () => {
                        if (!window.confirm('이 반복 일정을 전부 지울까요?')) return;
                        const r = await api.admin.removeSeries(b.seriesId!);
                        return `반복 일정 ${r.removed}개를 지웠어요.`;
                      })
                    }
                  >
                    반복 전체
                  </button>
                )}
              </div>
            </li>
          ))}
          {day.bookings.map((b) => (
            <li key={b.id} className={`alist__item alist__item--${b.status}`}>
              <div>
                <p className="alist__when">
                  {timeRange(b.start, b.end)} <span className="slot-tag">{slotLabel(b.slot)}</span>
                </p>
                <p className="alist__what">
                  <strong>{b.name}</strong> <span className={`badge badge--${b.status}`}>{STATUS_LABEL[b.status]}</span>
                </p>
                {b.memo && <p className="booking__memo">{b.memo}</p>}
              </div>
              <BookingActions b={b} working={working} run={run} />
            </li>
          ))}
        </ul>

        <AddBusyForm date={day.date} ctx={ctx} onAdded={onChanged} />
      </aside>
    </>
  );
}

function BookingActions({
  b,
  working,
  run,
}: {
  b: OwnerBooking;
  working: string | null;
  run: (id: string, fn: () => Promise<string | void>) => void;
}) {
  if (b.status === 'pending') {
    return (
      <div className="booking__actions">
        <button
          className="btn btn--primary btn--small"
          disabled={working === b.id}
          onClick={() =>
            run(b.id, async () => {
              const r = await api.admin.decide(b.id, 'confirm');
              return r.conflicts.length
                ? `수락했어요. 다만 ${r.conflicts.map((c) => c.title || '일정').join(', ')}과(와) 시간이 겹쳐요.`
                : `${b.name}님 약속을 확정했어요.`;
            })
          }
        >
          수락
        </button>
        <button
          className="btn btn--small"
          disabled={working === b.id}
          onClick={() =>
            run(b.id, async () => {
              const reason = window.prompt(`${b.name}님에게 보일 거절 메시지 (비워도 돼요)`, '');
              if (reason === null) return;
              await api.admin.decide(b.id, 'reject', reason.trim() || undefined);
              return '거절했어요.';
            })
          }
        >
          거절
        </button>
      </div>
    );
  }
  if (b.status === 'confirmed') {
    return (
      <div className="booking__actions">
        <button
          className="btn btn--quiet btn--small"
          disabled={working === b.id}
          onClick={() =>
            run(b.id, async () => {
              const reason = window.prompt(`${b.name}님과의 약속을 취소할까요? 친구에게 보일 사유 (비워도 돼요)`, '');
              if (reason === null) return;
              await api.admin.cancel(b.id, reason.trim() || undefined);
              return '약속을 취소했어요.';
            })
          }
        >
          약속 취소
        </button>
      </div>
    );
  }
  return null;
}

function AddBusyForm({ date, ctx, onAdded }: { date: string; ctx: Ctx; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [allDay, setAllDay] = useState(false);
  const [start, setStart] = useState('19:00');
  const [end, setEnd] = useState('22:00');
  const [endDate, setEndDate] = useState(date);
  const [title, setTitle] = useState('');
  const [repeat, setRepeat] = useState(false);
  const [until, setUntil] = useState(addDays(date, 28));
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button className="btn btn--block add-busy-open" onClick={() => setOpen(true)}>
        <Plus size={18} aria-hidden /> 이날 불가능 시간 추가
      </button>
    );
  }

  const multiDay = endDate > date;
  const valid = allDay || multiDay || end > start || end === '24:00';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      const startT = allDay ? '00:00' : start;
      const endT = allDay ? '24:00' : end;
      const r = repeat
        ? await api.admin.addBusy({
            repeat: { weekdays: [weekday(date)], startTime: startT, endTime: endT, from: date, until },
            title: title.trim() || undefined,
          })
        : await api.admin.addBusy({
            blocks: [
              {
                start: stamp(date, startT),
                end: allDay ? stamp(multiDay ? endDate : date, '24:00') : stamp(multiDay ? endDate : date, endT),
                title: title.trim() || undefined,
              },
            ],
          });
      ctx.notify(
        `${r.created}개 등록했어요.` +
          (r.conflicts.length ? ` 겹치는 신청이 있어요: ${r.conflicts.map((c) => `${c.name}(${STATUS_LABEL[c.status]})`).join(', ')}` : ''),
      );
      setOpen(false);
      setTitle('');
      onAdded();
    } catch (err) {
      ctx.fail(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="add-busy" onSubmit={submit}>
      <h3 className="section-title section-title--sm">불가능 시간 추가</h3>
      <label className="field">
        <span>
          제목 <em>(나만 보여요)</em>
        </span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} placeholder="예: 팀 회의" />
      </label>
      <label className="check">
        <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> 하루 종일
      </label>
      {!allDay && (
        <div className="custom custom--flat">
          <label>
            시작
            <select value={start} onChange={(e) => setStart(e.target.value)}>
              {TIMES.slice(0, -1).map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <span aria-hidden>–</span>
          <label>
            끝
            <select value={end} onChange={(e) => setEnd(e.target.value)}>
              {TIMES.slice(1).map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
        </div>
      )}
      {!repeat && (
        <label className="field">
          <span>
            끝나는 날 <em>(여러 날이면)</em>
          </span>
          <input type="date" value={endDate} min={date} onChange={(e) => setEndDate(e.target.value || date)} />
        </label>
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={repeat}
          onChange={(e) => {
            setRepeat(e.target.checked);
            setEndDate(date);
          }}
        />{' '}
        매주 {WEEK[weekday(date)]}요일 반복
      </label>
      {repeat && (
        <label className="field">
          <span>반복 끝나는 날</span>
          <input type="date" value={until} min={date} onChange={(e) => setUntil(e.target.value)} />
        </label>
      )}
      {!valid && <p className="field-error">끝 시간이 시작보다 뒤여야 해요</p>}
      <div className="row">
        <button className="btn btn--primary" disabled={busy || !valid}>
          {busy ? '등록하는 중…' : '등록하기'}
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => setOpen(false)}>
          닫기
        </button>
      </div>
    </form>
  );
}

// ---------------- 신청 ----------------

function Requests({ ctx }: { ctx: Ctx }) {
  const [tab, setTab] = useState<'pending' | 'confirmed' | 'done'>('pending');
  const [list, setList] = useState<OwnerBooking[] | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  const load = useCallback(() => {
    const status: BookingStatus | 'all' = tab === 'done' ? 'all' : tab;
    api.admin
      .bookings(status, tab === 'done')
      .then((r) =>
        setList(tab === 'done' ? r.bookings.filter((b) => b.status === 'rejected' || b.status === 'cancelled') : r.bookings),
      )
      .catch(ctx.fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  useEffect(load, [load]);

  async function run(id: string, fn: () => Promise<string | void>) {
    setWorking(id);
    try {
      const m = await fn();
      if (m) ctx.notify(m);
      load();
      ctx.changed();
    } catch (err) {
      ctx.fail(err);
    } finally {
      setWorking(null);
    }
  }

  return (
    <section aria-label="약속 신청">
      <div className="tabs tabs--sub" role="tablist">
        {(
          [
            ['pending', '신청 중'],
            ['confirmed', '확정'],
            ['done', '거절·취소'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className="tab tab--sub" onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {list && list.length === 0 && <p className="empty">여기는 비어 있어요.</p>}
      <ul className="bookings">
        {(list ?? []).map((b) => (
          <li key={b.id} className={`booking booking--${b.status}`}>
            <div className="booking__main">
              <span className={`badge badge--${b.status}`}>{STATUS_LABEL[b.status]}</span>
              <p className="booking__when">{whenParts(b.start, b.end).date}</p>
              <p className="booking__time">{whenParts(b.start, b.end).time}</p>
              <p className="booking__who">
                <strong>{b.name}</strong> <span className="slot-tag">{slotLabel(b.slot)}</span>
              </p>
              {b.memo && <p className="booking__memo">{b.memo}</p>}
              {b.reason && <p className="booking__reason">사유: {b.reason}</p>}
            </div>
            <BookingActions b={b} working={working} run={run} />
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------- 설정 ----------------

function SettingsTab({ ctx }: { ctx: Ctx }) {
  const [s, setS] = useState<Settings | null>(null);
  const [title, setTitle] = useState('');
  const [until, setUntil] = useState('');
  const [noLimit, setNoLimit] = useState(false);
  const [busy, setBusy] = useState(false);

  const apply = (v: Settings) => {
    setS(v);
    setTitle(v.siteTitle);
    setUntil(v.bookingUntil ?? '');
    setNoLimit(!v.bookingUntil);
  };
  useEffect(() => {
    api.admin.settings().then(apply).catch(ctx.fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!s) return <p className="muted">불러오는 중…</p>;

  return (
    <div className="settings">
      <form
        className="card form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            apply(await api.admin.saveSettings({ siteTitle: title.trim(), bookingUntil: noLimit ? '' : until }));
            ctx.notify('설정을 저장했어요. 친구 화면은 새로고침하면 바뀌어요.');
          } catch (err) {
            ctx.fail(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 className="section-title">친구 화면</h2>
        <label className="field">
          <span>제목</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={40} required />
          <small>{s.source.siteTitle === 'env' ? '지금은 .env의 SITE_TITLE 값이에요.' : '관리자 화면에서 정한 값이에요.'}</small>
        </label>
        <label className="field">
          <span>신청 마감 날짜</span>
          <input type="date" value={until} disabled={noLimit} onChange={(e) => setUntil(e.target.value)} />
          <small>
            {s.source.bookingUntil === 'env' ? '지금은 .env의 BOOKING_UNTIL 값이에요. ' : ''}이 날짜까지만 신청을 받아요. 오늘부터 90일보다
            늦으면 90일이 끝이에요.
          </small>
        </label>
        <label className="check">
          <input type="checkbox" checked={noLimit} onChange={(e) => setNoLimit(e.target.checked)} /> 마감 없이 90일까지 받기
        </label>
        <button className="btn btn--primary" disabled={busy || (!noLimit && !until) || !title.trim()}>
          {busy ? '저장하는 중…' : '저장하기'}
        </button>
      </form>

      <section className="card">
        <h2 className="section-title">Grok 연결 정보</h2>
        <p>
          MCP 주소: <code>{`${window.location.origin}/mcp`}</code>
        </p>
        <p>인증: Bearer 토큰 = 서버 .env의 OWNER_KEY (관리자 비밀번호와 다름)</p>
        <p className="muted">신청 가능 기간: {ctx.config.bookableFrom} ~ {ctx.config.bookableTo} (저장 후 새로고침하면 반영)</p>
      </section>
    </div>
  );
}
