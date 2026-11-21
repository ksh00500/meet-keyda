import { ArrowLeft } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { navigate } from '../App.js';
import { ApiError, api, local, type Config, type FriendBooking } from '../api.js';
import { STATUS_LABEL, slotLabel, whenLabel } from '../format.js';

export function MinePage({ config }: { config: Config }) {
  const [list, setList] = useState<FriendBooking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [lookupMsg, setLookupMsg] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  const load = useCallback(() => {
    const tokens = local.tokens();
    if (tokens.length === 0) {
      setList([]);
      return;
    }
    setError(null);
    api
      .mine(tokens)
      .then((r) => setList(r.bookings))
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    setLookupMsg(null);
    setWorking('lookup');
    try {
      const r = await api.lookup(name.trim(), pin);
      local.addTokens(r.bookings.map((b) => b.token));
      setLookupMsg(`${r.bookings.length}개를 찾았어요. 이제 이 기기에서도 보여요.`);
      setPin('');
      load();
    } catch (err) {
      setLookupMsg(err instanceof ApiError ? err.message : '잠시 후 다시 시도해 주세요');
    } finally {
      setWorking(null);
    }
  }

  async function cancel(b: FriendBooking) {
    if (!window.confirm(`${whenLabel(b.start, b.end)} 신청을 취소할까요?`)) return;
    setWorking(b.id);
    try {
      await api.cancelMine(b.id, local.tokens());
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '취소하지 못했어요. 잠시 후 다시 시도해 주세요');
    } finally {
      setWorking(null);
    }
  }

  const upcoming = (list ?? []).filter((b) => b.end > `${config.today}T00:00`);
  const past = (list ?? []).filter((b) => b.end <= `${config.today}T00:00`);

  return (
    <main className="page page--narrow">
      <button className="link-btn" onClick={() => navigate('/')}>
        <ArrowLeft size={18} aria-hidden /> 캘린더로
      </button>
      <h1 className="page-title">내 신청</h1>

      {error && (
        <div className="notice notice--error" role="alert">
          <p>{error}</p>
          <button className="btn" onClick={load}>다시 시도</button>
        </div>
      )}

      {list && upcoming.length === 0 && past.length === 0 && (
        <p className="empty">아직 이 기기에서 신청한 약속이 없어요.</p>
      )}

      <ul className="bookings">
        {[...upcoming, ...past].map((b) => (
          <li key={b.id} className={`booking booking--${b.status}`}>
            <div className="booking__main">
              <span className={`badge badge--${b.status}`}>{STATUS_LABEL[b.status]}</span>
              <p className="booking__when">{whenLabel(b.start, b.end)}</p>
              <p className="booking__slot">{slotLabel(b.slot)}</p>
              {b.reason && <p className="booking__reason">“{b.reason}”</p>}
            </div>
            {b.status === 'pending' && (
              <button className="btn btn--quiet" onClick={() => cancel(b)} disabled={working === b.id}>
                {working === b.id ? '취소하는 중…' : '취소하기'}
              </button>
            )}
          </li>
        ))}
      </ul>

      <section className="card">
        <h2 className="section-title">다른 기기에서 신청했나요?</h2>
        <p className="muted">신청할 때 쓴 이름과 PIN을 넣으면 여기서도 볼 수 있어요.</p>
        <form className="form form--inline" onSubmit={lookup}>
          <label className="field">
            <span>이름</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} required />
          </label>
          <label className="field field--pin">
            <span>PIN</span>
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              inputMode="numeric"
              autoComplete="off"
              pattern="\d{4}"
              required
            />
          </label>
          <button className="btn btn--primary" disabled={working === 'lookup' || !name.trim() || pin.length !== 4}>
            {working === 'lookup' ? '찾는 중…' : '찾기'}
          </button>
        </form>
        {lookupMsg && <p className="muted" role="status">{lookupMsg}</p>}
      </section>
    </main>
  );
}
