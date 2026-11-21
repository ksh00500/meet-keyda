import { CheckCircle2, Clock, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { blockingKind, slotStatuses } from '../../../server/domain/availability.js';
import { STEP_MIN, minToTime, slotRange, type SlotKind } from '../../../server/domain/time.js';
import { navigate } from '../App.js';
import { ApiError, api, local, type CalendarDay, type Config, type FriendBooking } from '../api.js';
import { dateLabel, slotLabel, timeRange } from '../format.js';
import { Timeline } from './Timeline.js';

const TIMES = Array.from({ length: (24 * 60) / STEP_MIN + 1 }, (_, i) => minToTime(i * STEP_MIN));
const REASON = { busy: '불가', booked: '예약됨' } as const;

interface Props {
  config: Config;
  day: CalendarDay;
  onClose: () => void;
  onBooked: () => void;
}

export function DayPanel({ config, day, onClose, onBooked }: Props) {
  const [choice, setChoice] = useState<SlotKind | null>(null);
  const [customStart, setCustomStart] = useState('15:00');
  const [customEnd, setCustomEnd] = useState('17:00');
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<FriendBooking | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const statuses = useMemo(() => slotStatuses(day.date, day.blocks), [day]);

  // 고른 시간과 그 시간이 막혔는지
  const selection = useMemo(() => {
    if (!choice) return null;
    const r = slotRange(day.date, choice, customStart, customEnd);
    if (!r.ok) return { range: null, problem: r.message };
    const kind = blockingKind(r.range.start, r.range.end, day.blocks);
    return {
      range: r.range,
      problem: kind ? `${timeRange(r.range.start, r.range.end)} 사이에 ${REASON[kind]}인 시간이 있어요` : null,
    };
  }, [choice, customStart, customEnd, day]);

  const pick = (slot: SlotKind) => {
    setChoice(slot);
    setError(null);
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  };

  const canSubmit = !!selection?.range && !selection.problem && name.trim() !== '' && /^\d{4}$/.test(pin) && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !choice) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.createBooking({
        date: day.date,
        slot: choice,
        ...(choice === 'custom' ? { start: customStart, end: customEnd } : {}),
        name: name.trim(),
        pin,
        memo: memo.trim(),
      });
      local.addTokens([r.token]);
      setDone(r);
      onBooked();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '잠시 후 다시 시도해 주세요');
      if (err instanceof ApiError && err.code === 'conflict') onBooked();
    } finally {
      setBusy(false);
    }
  }

  const noneAvailable = statuses.every((s) => !s.available);

  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden />
      <aside className="panel" role="dialog" aria-modal="true" aria-labelledby="panel-title" tabIndex={-1} ref={panelRef}>
        <div className="panel__head">
          <h2 id="panel-title">{dateLabel(day.date)}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">
            <X size={22} />
          </button>
        </div>

        {done ? (
          <div className="done">
            <CheckCircle2 size={40} className="done__icon" aria-hidden />
            <h3>신청했어요</h3>
            <p className="done__when">
              {dateLabel(day.date)} · {slotLabel(done.slot)} {timeRange(done.start, done.end)}
            </p>
            <p className="muted">확인되면 "내 신청"에서 확정으로 바뀌어요. 다른 기기에서는 이름과 PIN으로 찾을 수 있어요.</p>
            <div className="row">
              <button className="btn btn--primary" onClick={() => navigate('/mine')}>내 신청 보기</button>
              <button className="btn" onClick={onClose}>캘린더로</button>
            </div>
          </div>
        ) : (
          <>
            <Timeline date={day.date} blocks={day.blocks} selection={selection?.range ?? null} />

            <h3 className="section-title">언제 볼까요?</h3>
            {noneAvailable && <p className="muted">기본 시간대는 모두 찼어요. 직접 선택으로 빈 시간을 골라 보세요.</p>}
            <div className="chips" role="radiogroup" aria-label="시간대">
              {config.slots.map((s) => {
                const st = statuses.find((x) => x.id === s.id)!;
                return (
                  <button
                    key={s.id}
                    role="radio"
                    aria-checked={choice === s.id}
                    className={`chip${choice === s.id ? ' chip--on' : ''}`}
                    disabled={!st.available}
                    onClick={() => pick(s.id)}
                  >
                    <span className="chip__label">{s.label}</span>
                    <span className="chip__time">{st.available ? `${s.start}–${s.end}` : REASON[st.reason!]}</span>
                  </button>
                );
              })}
              <button
                role="radio"
                aria-checked={choice === 'custom'}
                className={`chip chip--custom${choice === 'custom' ? ' chip--on' : ''}`}
                onClick={() => pick('custom')}
              >
                <span className="chip__label">
                  <Clock size={15} aria-hidden /> 직접 선택
                </span>
                <span className="chip__time">30분 단위</span>
              </button>
            </div>

            {choice === 'custom' && (
              <div className="custom">
                <label>
                  시작
                  <select value={customStart} onChange={(e) => setCustomStart(e.target.value)}>
                    {TIMES.slice(0, -1).map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </label>
                <span aria-hidden>–</span>
                <label>
                  끝
                  <select value={customEnd} onChange={(e) => setCustomEnd(e.target.value)}>
                    {TIMES.slice(1).map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            {selection?.problem && (
              <p className="field-error" role="status">{selection.problem}</p>
            )}

            {choice && (
              <form className="form" ref={formRef} onSubmit={submit}>
                <label className="field">
                  <span>이름</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={20}
                    autoComplete="nickname"
                    placeholder="누군지 알 수 있는 이름"
                    required
                  />
                </label>
                <label className="field">
                  <span>PIN 4자리</span>
                  <input
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="0000"
                    pattern="\d{4}"
                    required
                  />
                  <small>다른 기기에서 내 신청을 찾거나 취소할 때 써요</small>
                </label>
                <label className="field">
                  <span>메모 <em>(선택)</em></span>
                  <textarea
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                    maxLength={200}
                    rows={2}
                    placeholder="예: 회사 근처 파스타 어때"
                  />
                </label>
                {error && (
                  <p className="field-error" role="alert">{error}</p>
                )}
                <button className="btn btn--primary btn--block" disabled={!canSubmit}>
                  {busy ? '신청하는 중…' : selection?.range ? `${timeRange(selection.range.start, selection.range.end)} 신청하기` : '신청하기'}
                </button>
              </form>
            )}
          </>
        )}
      </aside>
    </>
  );
}
