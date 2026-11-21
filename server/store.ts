import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { DB } from './db.js';
import { dayState, type DayBlock, type DayState } from './domain/availability.js';
import { expandRepeat, type RepeatRule } from './domain/repeat.js';
import {
  addDays,
  bookableRange,
  clipToDay,
  isDate,
  isMonth,
  isStamp,
  monthDays,
  nowKst,
  slotRange,
  type SlotKind,
} from './domain/time.js';

export type BookingStatus = 'pending' | 'confirmed' | 'rejected' | 'cancelled';
export const ACTIVE_STATUSES: BookingStatus[] = ['pending', 'confirmed'];

export const NAME_MAX = 20;
export const MEMO_MAX = 200;
export const TITLE_MAX = 100;
export const LOOKUP_MAX_FAILS = 5;
export const LOOKUP_LOCK_MS = 10 * 60_000;
const MAX_BUSY_SPAN_DAYS = 31;

interface BookingRow {
  id: string;
  start_at: string;
  end_at: string;
  slot: SlotKind;
  name: string;
  name_key: string;
  pin_hash: string;
  memo: string;
  status: BookingStatus;
  reason: string | null;
  cancelled_by: string | null;
  created_at: string;
  decided_at: string | null;
}

interface BusyRow {
  id: string;
  start_at: string;
  end_at: string;
  title: string;
  series_id: string | null;
  created_at: string;
}

/** 친구에게 보여도 되는 신청 정보 (본인 신청) */
export interface FriendBooking {
  id: string;
  start: string;
  end: string;
  slot: SlotKind;
  status: BookingStatus;
  reason: string | null;
}

/** 주인·MCP용 신청 정보 (PIN·토큰은 절대 포함하지 않음) */
export interface OwnerBooking extends FriendBooking {
  name: string;
  memo: string;
  createdAt: string;
  decidedAt: string | null;
  cancelledBy: string | null;
}

export interface Busy {
  id: string;
  start: string;
  end: string;
  title: string;
  seriesId: string | null;
}

export interface CalendarDay {
  date: string;
  state: DayState;
  blocks: DayBlock[];
}

export type Fail = { ok: false; error: string; message: string; status?: number };

const newId = (prefix: string) => `${prefix}_${randomBytes(6).toString('hex')}`;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function nameKey(name: string): string {
  return name.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(pin, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(expected, actual);
}

const toFriend = (r: BookingRow): FriendBooking => ({
  id: r.id,
  start: r.start_at,
  end: r.end_at,
  slot: r.slot,
  status: r.status,
  reason: r.reason,
});

const toOwner = (r: BookingRow): OwnerBooking => ({
  ...toFriend(r),
  name: r.name,
  memo: r.memo,
  createdAt: r.created_at,
  decidedAt: r.decided_at,
  cancelledBy: r.cancelled_by,
});

const toBusy = (r: BusyRow): Busy => ({
  id: r.id,
  start: r.start_at,
  end: r.end_at,
  title: r.title,
  seriesId: r.series_id,
});

export interface CreateBookingInput {
  date: unknown;
  slot: unknown;
  start?: unknown;
  end?: unknown;
  name: unknown;
  pin: unknown;
  memo?: unknown;
}

export interface BusyInput {
  start: unknown;
  end: unknown;
  title?: unknown;
}

export class Store {
  constructor(
    readonly db: DB,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private nowIso(): string {
    return this.clock().toISOString();
  }

  // ---------- 공통 ----------

  findConflicts(start: string, end: string, excludeBookingId?: string): { busy: Busy[]; bookings: OwnerBooking[] } {
    const busy = this.db
      .prepare<[string, string], BusyRow>('SELECT * FROM busy_blocks WHERE start_at < ? AND end_at > ? ORDER BY start_at')
      .all(end, start)
      .map(toBusy);
    const bookings = this.db
      .prepare<[string, string], BookingRow>(
        `SELECT * FROM bookings WHERE status IN ('pending','confirmed') AND start_at < ? AND end_at > ? ORDER BY start_at`,
      )
      .all(end, start)
      .filter((b) => b.id !== excludeBookingId)
      .map(toOwner);
    return { busy, bookings };
  }

  private getBooking(id: string): BookingRow | undefined {
    return this.db.prepare<[string], BookingRow>('SELECT * FROM bookings WHERE id = ?').get(id);
  }

  // ---------- 친구 ----------

  calendar(month: string): { month: string; days: CalendarDay[] } | Fail {
    if (!isMonth(month)) return { ok: false, error: 'bad_month', message: '월 형식이 맞지 않아요 (YYYY-MM)' };
    const days = monthDays(month);
    const from = `${days[0]}T00:00`;
    const to = `${addDays(days[days.length - 1], 1)}T00:00`;
    const { from: openFrom, to: openTo } = bookableRange(this.clock());
    const busy = this.db
      .prepare<[string, string], BusyRow>('SELECT * FROM busy_blocks WHERE start_at < ? AND end_at > ?')
      .all(to, from);
    const booked = this.db
      .prepare<[string, string], BookingRow>(
        `SELECT * FROM bookings WHERE status IN ('pending','confirmed') AND start_at < ? AND end_at > ?`,
      )
      .all(to, from);
    // 친구에게는 구간과 종류만. 제목·이름·메모는 여기서 버린다.
    const all: DayBlock[] = [
      ...busy.map((b) => ({ start: b.start_at, end: b.end_at, kind: 'busy' as const })),
      ...booked.map((b) => ({ start: b.start_at, end: b.end_at, kind: 'booked' as const })),
    ];
    return {
      month,
      days: days.map((date) => {
        const blocks = all
          .map((b) => {
            const c = clipToDay(b, date);
            return c ? { ...c, kind: b.kind } : null;
          })
          .filter((b): b is DayBlock => b !== null)
          .sort((a, b) => (a.start < b.start ? -1 : 1));
        const inWindow = date >= openFrom && date <= openTo;
        return { date, state: dayState(date, blocks, inWindow), blocks };
      }),
    };
  }

  createBooking(input: CreateBookingInput): { ok: true; booking: FriendBooking; token: string } | Fail {
    const name = typeof input.name === 'string' ? input.name.normalize('NFC').trim().replace(/\s+/g, ' ') : '';
    if (!name) return { ok: false, error: 'bad_name', message: '이름을 적어 주세요' };
    if ([...name].length > NAME_MAX) return { ok: false, error: 'bad_name', message: `이름은 ${NAME_MAX}자까지예요` };
    if (typeof input.pin !== 'string' || !/^\d{4}$/.test(input.pin)) {
      return { ok: false, error: 'bad_pin', message: 'PIN은 숫자 4자리예요' };
    }
    const memo = typeof input.memo === 'string' ? input.memo.trim() : '';
    if ([...memo].length > MEMO_MAX) return { ok: false, error: 'bad_memo', message: `메모는 ${MEMO_MAX}자까지예요` };
    if (typeof input.slot !== 'string') return { ok: false, error: 'bad_slot', message: '시간대를 골라 주세요' };
    const r = slotRange(
      String(input.date),
      input.slot as SlotKind,
      typeof input.start === 'string' ? input.start : undefined,
      typeof input.end === 'string' ? input.end : undefined,
    );
    if (!r.ok) return { ok: false, error: r.error, message: r.message };
    const date = String(input.date);
    const { from, to } = bookableRange(this.clock());
    if (date < from || date > to) {
      return { ok: false, error: 'out_of_range', message: '내일부터 90일 안의 날짜만 신청할 수 있어요' };
    }
    const { start, end } = r.range;
    const pinHash = hashPin(input.pin);
    const token = randomBytes(32).toString('hex');
    const id = newId('bk');
    const now = this.nowIso();

    // 겹침 검사와 저장을 한 트랜잭션으로 묶어 동시 신청을 막는다.
    const tx = this.db.transaction((): Fail | null => {
      const c = this.findConflicts(start, end);
      if (c.busy.length > 0) return { ok: false, error: 'conflict', message: '그 시간에는 이미 일정이 있어요', status: 409 };
      if (c.bookings.length > 0) {
        return { ok: false, error: 'conflict', message: '방금 다른 신청이 들어왔어요. 다른 시간을 골라 주세요', status: 409 };
      }
      this.db
        .prepare(
          `INSERT INTO bookings (id, start_at, end_at, slot, name, name_key, pin_hash, memo, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
        )
        .run(id, start, end, input.slot, name, nameKey(name), pinHash, memo, now);
      this.db
        .prepare('INSERT INTO booking_tokens (token_hash, booking_id, created_at) VALUES (?, ?, ?)')
        .run(sha256(token), id, now);
      return null;
    });
    const fail = tx.immediate();
    if (fail) return fail;
    return { ok: true, booking: toFriend(this.getBooking(id)!), token };
  }

  /** 브라우저에 저장된 토큰으로 내 신청 찾기 */
  bookingsByTokens(tokens: unknown): FriendBooking[] {
    if (!Array.isArray(tokens)) return [];
    const hashes = tokens
      .filter((t): t is string => typeof t === 'string' && /^[0-9a-f]{64}$/.test(t))
      .slice(0, 100)
      .map(sha256);
    if (hashes.length === 0) return [];
    const rows = this.db
      .prepare<string[], BookingRow>(
        `SELECT DISTINCT b.* FROM bookings b JOIN booking_tokens t ON t.booking_id = b.id
         WHERE t.token_hash IN (${hashes.map(() => '?').join(',')}) ORDER BY b.start_at`,
      )
      .all(...hashes);
    return rows.map(toFriend);
  }

  /** 다른 기기에서 이름 + PIN으로 내 신청 찾기. 찾으면 이 기기용 토큰을 새로 준다. */
  lookup(
    name: unknown,
    pin: unknown,
  ): { ok: true; bookings: (FriendBooking & { token: string })[] } | (Fail & { retryAfterSec?: number }) {
    if (typeof name !== 'string' || !nameKey(name)) return { ok: false, error: 'bad_name', message: '이름을 적어 주세요' };
    if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) return { ok: false, error: 'bad_pin', message: 'PIN은 숫자 4자리예요' };
    const key = nameKey(name);
    const nowMs = this.clock().getTime();
    const lock = this.db
      .prepare<[string], { fail_count: number; locked_until: number }>('SELECT * FROM lookup_locks WHERE name_key = ?')
      .get(key);
    if (lock && lock.locked_until > nowMs) {
      return {
        ok: false,
        error: 'locked',
        message: 'PIN을 여러 번 틀렸어요. 10분 뒤에 다시 시도해 주세요',
        status: 429,
        retryAfterSec: Math.ceil((lock.locked_until - nowMs) / 1000),
      };
    }
    const rows = this.db
      .prepare<[string], BookingRow>('SELECT * FROM bookings WHERE name_key = ? ORDER BY start_at')
      .all(key);
    const matched = rows.filter((r) => verifyPin(pin, r.pin_hash));
    if (matched.length === 0) {
      const fails = (lock?.fail_count ?? 0) + 1;
      const locked = fails >= LOOKUP_MAX_FAILS;
      this.db
        .prepare(
          `INSERT INTO lookup_locks (name_key, fail_count, locked_until) VALUES (?, ?, ?)
           ON CONFLICT(name_key) DO UPDATE SET fail_count = excluded.fail_count, locked_until = excluded.locked_until`,
        )
        .run(key, locked ? 0 : fails, locked ? nowMs + LOOKUP_LOCK_MS : 0);
      if (locked) {
        return {
          ok: false,
          error: 'locked',
          message: 'PIN을 여러 번 틀렸어요. 10분 뒤에 다시 시도해 주세요',
          status: 429,
          retryAfterSec: LOOKUP_LOCK_MS / 1000,
        };
      }
      return { ok: false, error: 'not_found', message: '이름과 PIN이 맞는 신청이 없어요', status: 404 };
    }
    this.db.prepare('DELETE FROM lookup_locks WHERE name_key = ?').run(key);
    const now = this.nowIso();
    const insert = this.db.prepare('INSERT INTO booking_tokens (token_hash, booking_id, created_at) VALUES (?, ?, ?)');
    const out = matched.map((r) => {
      const token = randomBytes(32).toString('hex');
      insert.run(sha256(token), r.id, now);
      return { ...toFriend(r), token };
    });
    return { ok: true, bookings: out };
  }

  /** 친구가 자기 '신청 중' 신청을 취소 (F14) */
  cancelByFriend(id: string, token: unknown): { ok: true; booking: FriendBooking } | Fail {
    if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) {
      return { ok: false, error: 'forbidden', message: '이 신청을 취소할 수 없어요', status: 403 };
    }
    const owns = this.db
      .prepare<[string, string], { booking_id: string }>(
        'SELECT booking_id FROM booking_tokens WHERE token_hash = ? AND booking_id = ?',
      )
      .get(sha256(token), id);
    if (!owns) return { ok: false, error: 'forbidden', message: '이 신청을 취소할 수 없어요', status: 403 };
    const row = this.getBooking(id);
    if (!row) return { ok: false, error: 'not_found', message: '신청을 찾을 수 없어요', status: 404 };
    if (row.status !== 'pending') {
      return { ok: false, error: 'not_pending', message: '신청 중인 약속만 직접 취소할 수 있어요. 확정된 약속은 직접 연락해 주세요', status: 409 };
    }
    this.db
      .prepare(`UPDATE bookings SET status = 'cancelled', cancelled_by = 'friend', decided_at = ? WHERE id = ?`)
      .run(this.nowIso(), id);
    return { ok: true, booking: toFriend(this.getBooking(id)!) };
  }

  // ---------- 주인·MCP ----------

  summary(): { pendingCount: number; nextConfirmed: OwnerBooking | null } {
    const { count } = this.db
      .prepare<[], { count: number }>(`SELECT COUNT(*) AS count FROM bookings WHERE status = 'pending'`)
      .get()!;
    const next = this.db
      .prepare<[string], BookingRow>(
        `SELECT * FROM bookings WHERE status = 'confirmed' AND end_at > ? ORDER BY start_at LIMIT 1`,
      )
      .get(nowKst(this.clock()).stamp);
    return { pendingCount: count, nextConfirmed: next ? toOwner(next) : null };
  }

  listBookings(opts: { status?: BookingStatus | 'all'; includePast?: boolean } = {}): OwnerBooking[] {
    const status = opts.status ?? 'all';
    const params: string[] = [];
    let where = '1=1';
    if (status !== 'all') {
      where += ' AND status = ?';
      params.push(status);
    }
    if (!opts.includePast) {
      where += ' AND end_at > ?';
      params.push(nowKst(this.clock()).stamp);
    }
    return this.db
      .prepare<string[], BookingRow>(
        `SELECT * FROM bookings WHERE ${where}
         ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'confirmed' THEN 1 ELSE 2 END, start_at`,
      )
      .all(...params)
      .map(toOwner);
  }

  decide(
    id: string,
    action: 'confirm' | 'reject',
    reason?: string,
  ): { ok: true; booking: OwnerBooking; conflicts: Busy[] } | Fail {
    const row = this.getBooking(id);
    if (!row) return { ok: false, error: 'not_found', message: '신청을 찾을 수 없어요', status: 404 };
    if (row.status !== 'pending') {
      return { ok: false, error: 'not_pending', message: `이미 처리된 신청이에요 (현재: ${row.status})`, status: 409 };
    }
    const status: BookingStatus = action === 'confirm' ? 'confirmed' : 'rejected';
    this.db
      .prepare('UPDATE bookings SET status = ?, reason = ?, decided_at = ? WHERE id = ?')
      .run(status, cleanText(reason, TITLE_MAX) || null, this.nowIso(), id);
    // 수락했는데 그사이 내 일정이 생겼으면 알려 준다 (내 일정이 우선이라 신청은 막히지 않았을 수 있음)
    const conflicts = action === 'confirm' ? this.findConflicts(row.start_at, row.end_at).busy : [];
    return { ok: true, booking: toOwner(this.getBooking(id)!), conflicts };
  }

  cancelBooking(id: string, reason?: string): { ok: true; booking: OwnerBooking } | Fail {
    const row = this.getBooking(id);
    if (!row) return { ok: false, error: 'not_found', message: '신청을 찾을 수 없어요', status: 404 };
    if (row.status !== 'pending' && row.status !== 'confirmed') {
      return { ok: false, error: 'not_active', message: `취소할 수 없는 상태예요 (현재: ${row.status})`, status: 409 };
    }
    this.db
      .prepare(`UPDATE bookings SET status = 'cancelled', cancelled_by = 'owner', reason = ?, decided_at = ? WHERE id = ?`)
      .run(cleanText(reason, TITLE_MAX) || null, this.nowIso(), id);
    return { ok: true, booking: toOwner(this.getBooking(id)!) };
  }

  addBusy(
    blocks: BusyInput[],
    seriesId: string | null = null,
  ): { ok: true; created: Busy[]; conflicts: OwnerBooking[] } | Fail {
    if (!Array.isArray(blocks) || blocks.length === 0) {
      return { ok: false, error: 'bad_input', message: '등록할 구간이 없습니다' };
    }
    if (blocks.length > 200) return { ok: false, error: 'bad_input', message: '한 번에 200개까지 등록할 수 있습니다' };
    const clean: { start: string; end: string; title: string }[] = [];
    for (const [i, b] of blocks.entries()) {
      if (!isStamp(b.start) || !isStamp(b.end)) {
        return { ok: false, error: 'bad_time', message: `${i + 1}번째 구간: 시간은 YYYY-MM-DDTHH:MM 형식이어야 합니다` };
      }
      if (b.end <= b.start) return { ok: false, error: 'bad_time', message: `${i + 1}번째 구간: 끝이 시작보다 뒤여야 합니다` };
      if (b.end > `${addDays(b.start.slice(0, 10), MAX_BUSY_SPAN_DAYS)}T00:00`) {
        return { ok: false, error: 'bad_time', message: `${i + 1}번째 구간: 한 구간은 최대 ${MAX_BUSY_SPAN_DAYS}일입니다` };
      }
      clean.push({ start: b.start, end: b.end, title: cleanText(b.title, TITLE_MAX) });
    }
    const now = this.nowIso();
    const insert = this.db.prepare(
      'INSERT INTO busy_blocks (id, start_at, end_at, title, series_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    const ids: string[] = [];
    this.db.transaction(() => {
      for (const b of clean) {
        const id = newId('bz');
        insert.run(id, b.start, b.end, b.title, seriesId, now);
        ids.push(id);
      }
    })();
    const created = ids.map((id) =>
      toBusy(this.db.prepare<[string], BusyRow>('SELECT * FROM busy_blocks WHERE id = ?').get(id)!),
    );
    const seen = new Set<string>();
    const conflicts: OwnerBooking[] = [];
    for (const b of clean) {
      for (const c of this.findConflicts(b.start, b.end).bookings) {
        if (!seen.has(c.id)) {
          seen.add(c.id);
          conflicts.push(c);
        }
      }
    }
    return { ok: true, created, conflicts };
  }

  addRepeat(
    rule: RepeatRule,
    title?: string,
  ): { ok: true; seriesId: string; created: Busy[]; conflicts: OwnerBooking[] } | Fail {
    const r = expandRepeat(rule);
    if (!r.ok) return { ok: false, error: 'bad_repeat', message: r.message };
    const seriesId = newId('sr');
    const res = this.addBusy(
      r.ranges.map((x) => ({ ...x, title })),
      seriesId,
    );
    if (!res.ok) return res;
    return { ...res, seriesId };
  }

  removeBusy(target: { id?: string; seriesId?: string }): { ok: true; removed: number } | Fail {
    if (target.id) {
      const n = this.db.prepare('DELETE FROM busy_blocks WHERE id = ?').run(target.id).changes;
      if (n === 0) return { ok: false, error: 'not_found', message: '그 일정을 찾을 수 없습니다', status: 404 };
      return { ok: true, removed: n };
    }
    if (target.seriesId) {
      const n = this.db.prepare('DELETE FROM busy_blocks WHERE series_id = ?').run(target.seriesId).changes;
      if (n === 0) return { ok: false, error: 'not_found', message: '그 반복 일정을 찾을 수 없습니다', status: 404 };
      return { ok: true, removed: n };
    }
    return { ok: false, error: 'bad_input', message: 'id나 seriesId가 필요합니다' };
  }

  listBusy(from: string, to: string): Busy[] {
    return this.db
      .prepare<[string, string], BusyRow>('SELECT * FROM busy_blocks WHERE start_at < ? AND end_at > ? ORDER BY start_at')
      .all(`${addDays(to, 1)}T00:00`, `${from}T00:00`)
      .map(toBusy);
  }

  /** 기간(양 끝 날짜 포함)의 내 일정과 신청 전체 */
  schedule(
    from: string,
    to: string,
    includeInactive = false,
  ): { ok: true; busy: Busy[]; bookings: OwnerBooking[] } | Fail {
    if (!isDate(from) || !isDate(to)) return { ok: false, error: 'bad_date', message: '날짜는 YYYY-MM-DD 형식이어야 합니다' };
    if (to < from) return { ok: false, error: 'bad_date', message: 'to가 from보다 앞입니다' };
    if (to > addDays(from, 366)) return { ok: false, error: 'bad_date', message: '한 번에 최대 1년까지 조회할 수 있습니다' };
    const end = `${addDays(to, 1)}T00:00`;
    const start = `${from}T00:00`;
    const statuses = includeInactive ? `'pending','confirmed','rejected','cancelled'` : `'pending','confirmed'`;
    const bookings = this.db
      .prepare<[string, string], BookingRow>(
        `SELECT * FROM bookings WHERE status IN (${statuses}) AND start_at < ? AND end_at > ? ORDER BY start_at`,
      )
      .all(end, start)
      .map(toOwner);
    return { ok: true, busy: this.listBusy(from, to), bookings };
  }
}

function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  return [...v.trim()].slice(0, max).join('');
}
