import { ArrowLeft, CheckCircle2, Clock, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { blockingKind, slotStatuses } from '../../../server/domain/availability.js';
import { SLOTS, STEP_MIN, minToTime, slotRange, timeToMin, type SlotKind } from '../../../server/domain/time.js';
import { navigate } from '../App.js';
import { ApiError, api, local, type CalendarDay, type Config, type FriendBooking } from '../api.js';
import { dateLabel, slotLabel, timeRange } from '../format.js';
import { Timeline } from './Timeline.js';

/**
 * 기본 칸 누르기: 이어 붙일 수 있으면 붙이고, 이미 고른 끝 칸이면 빼고, 아니면 그 칸 하나로 바꾼다.
 */
function toggleSlot(current: SlotKind | null, id: string): SlotKind | null {
  const order = SLOTS.map((s) => s.id);
  const picked = current && current !== 'custom' && current !== 'allday' ? current.split('+') : [];
  if (picked.length === 0) return id;
  const idx = picked.map((p) => order.indexOf(p)).sort((a, b) => a - b);
  const i = order.indexOf(id);
  const lo = idx[0];
  const hi = idx[idx.length - 1];
  let next: number[];
  if (idx.includes(i)) {
    if (idx.length === 1) return null;
    next = i === lo ? idx.slice(1) : i === hi ? idx.slice(0, -1) : [i];
  } else if (i === lo - 1 || i === hi + 1) {
    next = [...idx, i].sort((a, b) => a - b);
  } else {
    next = [i];
  }
  return next.map((n) => order[n]).join('+');
}

const TIMES = Array.from({ length: (24 * 60) / STEP_MIN + 1 }, (_, i) => minToTime(i * STEP_MIN));
const REASON = { busy: '불가', booked: '예약됨' } as const;

type Step = 'time' | 'info' | 'done';

interface Props {
  config: Config;
  day: CalendarDay;
  onClose: () => void;
  onBooked: () => void;
}

export function DayPanel({ config, day, onClose, onBooked }: Props) {
  const [step, setStep] = useState<Step>('time');
  const [choice, setChoice] = useState<SlotKind | null>(null);
  const [customStart, setCustomStart] = useState('15:00');
  const [customEnd, setCustomEnd] = useState('17:00');
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<FriendBooking | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    panelRef.current?.scrollTo({ top: 0 });
    if (step === 'info') nameRef.current?.focus();
  }, [step]);

  const statuses = useMemo(() => slotStatuses(day.date, day.blocks), [day]);
  // 지금 고른 기본 칸들 (예: 'am+lunch' → ['am','lunch'])
  const picked = choice && choice !== 'custom' && choice !== 'allday' ? choice.split('+') : [];

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

  const timeOk = !!selection?.range && !selection.problem;
  const infoOk = name.trim() !== '' && /^\d{4}$/.test(pin);

  // 시작을 바꾸면 끝이 시작보다 앞이 되지 않게 맞춘다
  const changeStart = (v: string) => {
    setCustomStart(v);
    if (timeToMin(customEnd) <= timeToMin(v)) setCustomEnd(minToTime(Math.min(timeToMin(v) + 60, 24 * 60)));
  };

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!timeOk || !infoOk || !choice || busy) return;
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
      setStep('done');
      onBooked();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '잠시 후 다시 시도해 주세요');
      if (err instanceof ApiError && err.code === 'conflict') {
        onBooked();
        setStep('time');
      }
    } finally {
      setBusy(false);
    }
  }

  const noneAvailable = statuses.every((s) => !s.available);
  const chosenLabel = selection?.range ? `${slotLabel(choice!)} ${timeRange(selection.range.start, selection.range.end)}` : '';

  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden />
      <aside className="panel" role="dialog" aria-modal="true" aria-labelledby="panel-title" tabIndex={-1} ref={panelRef}>
        <div className="panel__grip" aria-hidden />
        <div className="panel__head">
          {step === 'info' ? (
            <button className="icon-btn" onClick={() => setStep('time')} aria-label="시간 다시 고르기">
              <ArrowLeft size={22} />
            </button>
          ) : (
            <span className="panel__spacer" />
          )}
          <div className="panel__title">
            <h2 id="panel-title">{dateLabel(day.date)}</h2>
            {step !== 'done' && (
              <p className="steps" aria-label={`${step === 'time' ? 1 : 2}단계 / 2단계`}>
                <span className={step === 'time' ? 'steps__on' : ''}>시간</span>
                <span className={step === 'info' ? 'steps__on' : ''}>이름·PIN</span>
              </p>
            )}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">
            <X size={22} />
          </button>
        </div>

        {step === 'done' && done && (
          <div className="done">
            <CheckCircle2 size={44} className="done__icon" aria-hidden />
            <h3>신청했어요</h3>
            <dl className="done__summary">
              <dt>날짜</dt>
              <dd>{dateLabel(day.date)}</dd>
              <dt>시간</dt>
              <dd>
                {slotLabel(done.slot)} {timeRange(done.start, done.end)}
              </dd>
              <dt>이름</dt>
              <dd>{name.trim()}</dd>
            </dl>
            <p className="muted">
              지금은 <strong className="pending-word">신청 중</strong>이에요. 확정되면 "내 신청"에서 바뀐 걸 볼 수 있어요.
            </p>
            <p className="muted">다른 휴대폰에서도 이름과 PIN으로 찾을 수 있으니 PIN을 기억해 두세요.</p>
            <div className="sheet-actions">
              <button className="btn btn--primary btn--block" onClick={() => navigate('/mine')}>
                내 신청 보기
              </button>
              <button className="btn btn--ghost btn--block" onClick={onClose}>
                캘린더로 돌아가기
              </button>
            </div>
          </div>
        )}

        {step === 'time' && (
          <>
            <Timeline
              date={day.date}
              blocks={day.blocks}
              selection={selection?.range ?? null}
              onPick={(start, end) => {
                setChoice('custom');
                setCustomStart(start);
                setCustomEnd(end);
                setError(null);
              }}
            />
            <p className="hint hint--small">
              붙어 있는 칸을 이어서 누르면 함께 골라져요 (예: 오전+점심). 막대의 빈 곳을 눌러도 돼요.
            </p>

            {noneAvailable && <p className="hint">기본 시간대는 다 찼어요. 직접 선택으로 빈 시간을 골라 보세요.</p>}
            <div className="chips chips--four" role="group" aria-label="시간대 (여러 칸 이어서 선택 가능)">
              {config.slots.map((s) => {
                const st = statuses.find((x) => x.id === s.id)!;
                const on = picked.includes(s.id);
                return (
                  <button
                    key={s.id}
                    aria-pressed={on}
                    className={`chip${on ? ' chip--on' : ''}`}
                    disabled={!st.available}
                    onClick={() => {
                      setChoice(toggleSlot(choice, s.id));
                      setError(null);
                    }}
                  >
                    <span className="chip__label">{s.label}</span>
                    <span className="chip__time">{st.available ? `${s.start}–${s.end}` : REASON[st.reason!]}</span>
                  </button>
                );
              })}
            </div>
            <div className="chips chips--extra" role="group" aria-label="다른 선택">
              {(() => {
                const st = statuses.find((x) => x.id === 'allday')!;
                return (
                  <button
                    aria-pressed={choice === 'allday'}
                    className={`chip chip--wide${choice === 'allday' ? ' chip--on' : ''}`}
                    disabled={!st.available}
                    onClick={() => {
                      setChoice(choice === 'allday' ? null : 'allday');
                      setError(null);
                    }}
                  >
                    <span className="chip__label">{config.allday.label}</span>
                    <span className="chip__time">
                      {st.available ? `${config.allday.start}–${config.allday.end}` : REASON[st.reason!]}
                    </span>
                  </button>
                );
              })()}
              <button
                aria-pressed={choice === 'custom'}
                className={`chip chip--wide chip--custom${choice === 'custom' ? ' chip--on' : ''}`}
                onClick={() => {
                  setChoice(choice === 'custom' ? null : 'custom');
                  setError(null);
                }}
              >
                <span className="chip__label">
                  <Clock size={16} aria-hidden /> 직접 선택
                </span>
                <span className="chip__time">30분 단위</span>
              </button>
            </div>

            {choice === 'custom' && (
              <div className="custom">
                <label>
                  시작
                  <select value={customStart} onChange={(e) => changeStart(e.target.value)}>
                    {TIMES.slice(0, -1).map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <span aria-hidden>–</span>
                <label>
                  끝
                  <select value={customEnd} onChange={(e) => setCustomEnd(e.target.value)}>
                    {TIMES.filter((t) => timeToMin(t) > timeToMin(customStart)).map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            {selection?.problem && (
              <p className="field-error" role="status">
                {selection.problem}
              </p>
            )}
            {error && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}

            <div className="sheet-cta">
              <button className="btn btn--primary btn--block btn--tall" disabled={!timeOk} onClick={() => setStep('info')}>
                {timeOk ? `${timeRange(selection!.range!.start, selection!.range!.end)}로 다음` : '시간을 골라 주세요'}
              </button>
            </div>
          </>
        )}

        {step === 'info' && (
          <form className="form" onSubmit={submit}>
            <button type="button" className="chosen" onClick={() => setStep('time')}>
              <span className="chosen__label">고른 시간</span>
              <span className="chosen__value">{chosenLabel}</span>
              <span className="chosen__edit">바꾸기</span>
            </button>
            <label className="field">
              <span>이름</span>
              <input
                ref={nameRef}
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
                className="pin-input"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                inputMode="numeric"
                autoComplete="off"
                placeholder="숫자 4자리"
                pattern="\d{4}"
                required
              />
              <small>다른 휴대폰에서 내 신청을 찾거나 취소할 때 써요</small>
            </label>
            <label className="field">
              <span>
                메모 <em>(선택)</em>
              </span>
              <textarea
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                maxLength={200}
                rows={2}
                placeholder="예: 회사 근처 파스타 어때"
              />
            </label>
            {error && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}
            <div className="sheet-cta">
              <button className="btn btn--primary btn--block btn--tall" disabled={!infoOk || busy}>
                {busy ? '신청하는 중…' : '신청하기'}
              </button>
            </div>
          </form>
        )}
      </aside>
    </>
  );
}
