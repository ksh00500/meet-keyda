import { ArrowLeft, LogOut, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { navigate } from '../App.js';
import { ApiError, api, local, type BookingStatus, type Busy, type Config, type OwnerBooking } from '../api.js';
import { STATUS_LABEL, dateLabel, slotLabel, timeRange, whenLabel } from '../format.js';

type Tab = 'pending' | 'confirmed' | 'done';
const TABS: { id: Tab; label: string }[] = [
  { id: 'pending', label: '신청 중' },
  { id: 'confirmed', label: '확정' },
  { id: 'done', label: '거절·취소' },
];

export function OwnerPage({ config }: { config: Config }) {
  const [key, setKey] = useState<string | null>(() => local.ownerKey());
  const [input, setInput] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [tab, setTab] = useState<Tab>('pending');
  const [bookings, setBookings] = useState<OwnerBooking[] | null>(null);
  const [busyList, setBusyList] = useState<Busy[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  const handle = useCallback((err: unknown) => {
    if (err instanceof ApiError && err.status === 401) {
      local.setOwnerKey(null);
      setKey(null);
      setAuthError('키가 맞지 않아요. 다시 넣어 주세요');
      return;
    }
    setError(err instanceof Error ? err.message : '잠시 후 다시 시도해 주세요');
  }, []);

  const load = useCallback(async () => {
    if (!key) return;
    setError(null);
    try {
      const status: BookingStatus | 'all' = tab === 'done' ? 'all' : tab;
      const [s, b, z] = await Promise.all([
        api.owner.summary(key),
        api.owner.bookings(key, status),
        api.owner.busy(key),
      ]);
      setPending(s.pendingCount);
      document.title = s.pendingCount > 0 ? `(${s.pendingCount}) 주인 화면` : '주인 화면';
      setBookings(tab === 'done' ? b.bookings.filter((x) => x.status === 'rejected' || x.status === 'cancelled') : b.bookings);
      setBusyList(z.busy);
    } catch (err) {
      handle(err);
    }
  }, [key, tab, handle]);

  useEffect(() => {
    void load();
  }, [load]);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    const k = input.trim();
    setAuthError(null);
    try {
      await api.owner.summary(k);
      local.setOwnerKey(k);
      setKey(k);
      setInput('');
    } catch (err) {
      setAuthError(err instanceof ApiError && err.status === 401 ? '키가 맞지 않아요' : '잠시 후 다시 시도해 주세요');
    }
  }

  async function act(id: string, fn: () => Promise<string | void>) {
    setWorking(id);
    setNotice(null);
    try {
      const msg = await fn();
      if (msg) setNotice(msg);
      await load();
    } catch (err) {
      handle(err);
    } finally {
      setWorking(null);
    }
  }

  const decide = (b: OwnerBooking, action: 'confirm' | 'reject') =>
    act(b.id, async () => {
      let reason: string | undefined;
      if (action === 'reject') {
        const r = window.prompt(`${b.name}님에게 보일 거절 메시지 (비워도 돼요)`, '');
        if (r === null) return;
        reason = r.trim() || undefined;
      }
      const res = await api.owner.decide(key!, b.id, action, reason);
      if (res.conflicts.length > 0) {
        return `수락했어요. 다만 ${res.conflicts.map((c) => c.title || '일정').join(', ')}과(와) 시간이 겹쳐요.`;
      }
    });

  const cancel = (b: OwnerBooking) =>
    act(b.id, async () => {
      const r = window.prompt(`${b.name}님과의 약속을 취소할까요? 친구에게 보일 사유 (비워도 돼요)`, '');
      if (r === null) return;
      await api.owner.cancel(key!, b.id, r.trim() || undefined);
    });

  const removeBusy = (z: Busy, series: boolean) =>
    act(z.id, async () => {
      const what = series ? '이 반복 일정 전체를' : `${whenLabel(z.start, z.end)} 일정을`;
      if (!window.confirm(`${what} 지울까요? 친구 화면에서 그 시간이 다시 열려요.`)) return;
      const r = series ? await api.owner.removeSeries(key!, z.seriesId!) : await api.owner.removeBusy(key!, z.id);
      return `${r.removed}개를 지웠어요.`;
    });

  if (!key) {
    return (
      <main className="page page--narrow">
        <button className="link-btn" onClick={() => navigate('/')}>
          <ArrowLeft size={18} aria-hidden /> 캘린더로
        </button>
        <h1 className="page-title">주인 화면</h1>
        <form className="card form" onSubmit={login}>
          <label className="field">
            <span>비밀 키</span>
            <input
              type="password"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              autoComplete="current-password"
              required
            />
            <small>서버 .env의 OWNER_KEY 값이에요. 이 브라우저에만 기억해요.</small>
          </label>
          {authError && <p className="field-error" role="alert">{authError}</p>}
          <button className="btn btn--primary">들어가기</button>
        </form>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="owner-head">
        <button className="link-btn" onClick={() => navigate('/')}>
          <ArrowLeft size={18} aria-hidden /> 친구 화면 보기
        </button>
        <button
          className="link-btn"
          onClick={() => {
            local.setOwnerKey(null);
            setKey(null);
          }}
        >
          <LogOut size={18} aria-hidden /> 나가기
        </button>
      </div>
      <h1 className="page-title">
        {pending > 0 ? <>새 신청 <strong className="count">{pending}건</strong></> : '새 신청 없음'}
      </h1>

      {notice && <p className="notice" role="status">{notice}</p>}
      {error && (
        <div className="notice notice--error" role="alert">
          <p>{error}</p>
          <button className="btn" onClick={() => void load()}>다시 시도</button>
        </div>
      )}

      <div className="owner-cols">
        <section aria-label="약속 신청">
          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className="tab" onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          {bookings && bookings.length === 0 && <p className="empty">여기는 비어 있어요.</p>}
          <ul className="bookings">
            {(bookings ?? []).map((b) => (
              <li key={b.id} className={`booking booking--${b.status}`}>
                <div className="booking__main">
                  <span className={`badge badge--${b.status}`}>{STATUS_LABEL[b.status]}</span>
                  <p className="booking__when">{whenLabel(b.start, b.end)}</p>
                  <p className="booking__who">
                    <strong>{b.name}</strong> · {slotLabel(b.slot)}
                  </p>
                  {b.memo && <p className="booking__memo">{b.memo}</p>}
                  {b.reason && <p className="booking__reason">사유: {b.reason}</p>}
                </div>
                <div className="booking__actions">
                  {b.status === 'pending' && (
                    <>
                      <button className="btn btn--primary" disabled={working === b.id} onClick={() => decide(b, 'confirm')}>
                        수락
                      </button>
                      <button className="btn" disabled={working === b.id} onClick={() => decide(b, 'reject')}>
                        거절
                      </button>
                    </>
                  )}
                  {b.status === 'confirmed' && (
                    <button className="btn btn--quiet" disabled={working === b.id} onClick={() => cancel(b)}>
                      약속 취소
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="내 불가능 시간" className="card">
          <h2 className="section-title">내 불가능 시간</h2>
          <p className="muted">등록은 Grok에게 말하면 돼요. 여기서는 확인하고 지울 수 있어요.</p>
          {busyList && busyList.length === 0 && <p className="empty">등록된 일정이 없어요.</p>}
          <ul className="busy-list">
            {(busyList ?? []).map((z) => (
              <li key={z.id}>
                <div>
                  <p className="busy__when">
                    {dateLabel(z.start.slice(0, 10))} · {timeRange(z.start, z.end)}
                  </p>
                  <p className="busy__title">
                    {z.title || '제목 없음'}
                    {z.seriesId && <span className="badge badge--series">반복</span>}
                  </p>
                </div>
                <div className="row">
                  <button className="icon-btn" disabled={working === z.id} onClick={() => removeBusy(z, false)} aria-label="이 일정 지우기">
                    <Trash2 size={18} />
                  </button>
                  {z.seriesId && (
                    <button className="btn btn--quiet btn--small" disabled={working === z.id} onClick={() => removeBusy(z, true)}>
                      반복 전체
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <details className="mcp-help">
            <summary>Grok 연결 정보</summary>
            <p>
              MCP 주소: <code>{`${window.location.origin}/mcp`}</code>
            </p>
            <p>인증: Bearer 토큰 = 이 화면에 넣은 비밀 키</p>
            <p className="muted">{config.title} · 신청 가능 기간 {config.bookableFrom} ~ {config.bookableTo}</p>
          </details>
        </section>
      </div>
    </main>
  );
}
