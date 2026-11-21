// 개발·점검용 예시 데이터. SEED_DEMO=1 이고 DB가 비어 있을 때만 넣는다.
import { addDays, nowKst, weekday } from './domain/time.js';
import type { Store } from './store.js';

export function seedDemo(store: Store, now: Date = new Date()): boolean {
  const { n } = store.db
    .prepare<[], { n: number }>('SELECT (SELECT COUNT(*) FROM busy_blocks) + (SELECT COUNT(*) FROM bookings) AS n')
    .get()!;
  if (n > 0) return false;

  const today = nowKst(now).date;
  const nextMon = addDays(today, ((8 - weekday(today)) % 7) || 7);
  const d = (offset: number) => addDays(nextMon, offset); // 0=다음 주 월요일

  store.addBusy([
    { start: `${d(0)}T09:00`, end: `${d(0)}T18:00`, title: '출근' },
    { start: `${d(1)}T19:00`, end: `${d(1)}T22:00`, title: '팀 회의' },
    { start: `${d(3)}T19:00`, end: `${d(3)}T22:00`, title: '스터디' },
    { start: `${d(5)}T00:00`, end: `${d(6)}T00:00`, title: '부산 여행' },
  ]);

  const book = (date: string, slot: string, name: string, memo: string) => {
    const r = store.createBooking({ date, slot, name, pin: '1234', memo });
    if (!r.ok) throw new Error(`seed booking failed: ${r.message}`);
    return r.booking.id;
  };
  book(d(2), 'lunch', '김민지', '회사 근처 파스타 어때');
  const junho = book(d(4), 'dinner', '박준호', '생일 겸 한잔');
  store.decide(junho, 'confirm');
  const seoyeon = book(d(6), 'pm', '이서연', '전시 보러 가자');
  store.decide(seoyeon, 'reject', '그날은 쉬고 싶어서 다음에!');
  return true;
}
