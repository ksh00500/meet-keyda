import type { DayBlock, DayState } from '../../server/domain/availability.js';
import type { SlotDef, SlotKind } from '../../server/domain/time.js';

export type BookingStatus = 'pending' | 'confirmed' | 'rejected' | 'cancelled';

export interface Config {
  title: string;
  today: string;
  bookableFrom: string;
  bookableTo: string;
  slots: SlotDef[];
  allday: SlotDef;
}

export interface CalendarDay {
  date: string;
  state: DayState;
  blocks: DayBlock[];
}

export interface FriendBooking {
  id: string;
  start: string;
  end: string;
  slot: SlotKind;
  status: BookingStatus;
  reason: string | null;
  token?: string;
}

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

export interface OwnerDay {
  date: string;
  busy: Busy[];
  bookings: OwnerBooking[];
}

export interface Settings {
  siteTitle: string;
  bookingUntil: string | null;
  source: { siteTitle: 'env' | 'admin'; bookingUntil: 'env' | 'admin' };
}

export type AddBusyBody =
  | { blocks: { start: string; end: string; title?: string }[] }
  | {
      repeat: { weekdays: number[]; startTime: string; endTime: string; from: string; until: string };
      title?: string;
    };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfterSec?: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit & { admin?: boolean } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');
  // 관리자 요청 표시 (서버가 쿠키 로그인으로 바꾸는 요청에 이 헤더를 요구한다)
  if (init.admin) headers.set('x-meet-admin', '1');
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiError(0, 'network', '연결이 끊겼어요. 잠시 후 다시 시도해 주세요');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      res.status,
      data.error ?? 'error',
      data.message ?? '잠시 후 다시 시도해 주세요',
      data.retryAfterSec,
    );
  }
  return data as T;
}

const post = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body) });

export const api = {
  config: () => request<Config>('/api/config'),
  calendar: (month: string) => request<{ month: string; days: CalendarDay[] }>(`/api/calendar?month=${month}`),
  createBooking: (body: {
    date: string;
    slot?: SlotKind;
    slots?: string[];
    start?: string;
    end?: string;
    name: string;
    pin: string;
    memo: string;
  }) => request<FriendBooking & { token: string }>('/api/bookings', post(body)),
  mine: (tokens: string[]) => request<{ bookings: FriendBooking[] }>('/api/bookings/mine', post({ tokens })),
  lookup: (name: string, pin: string) =>
    request<{ bookings: (FriendBooking & { token: string })[] }>('/api/bookings/lookup', post({ name, pin })),
  cancelMine: (id: string, tokens: string[]) => request<FriendBooking>(`/api/bookings/${id}/cancel`, post({ tokens })),

  admin: {
    login: (password: string) => request<{ ok: true }>('/api/admin/login', post({ password })),
    logout: () => request<{ ok: true }>('/api/admin/logout', { method: 'POST', admin: true }),
    me: () => request<{ ok: true }>('/api/owner/me'),
    summary: () => request<{ pendingCount: number; nextConfirmed: OwnerBooking | null }>('/api/owner/summary'),
    bookings: (status: BookingStatus | 'all', past = false) =>
      request<{ bookings: OwnerBooking[] }>(`/api/owner/bookings?status=${status}${past ? '&past=1' : ''}`),
    calendar: (month: string) => request<{ days: OwnerDay[] }>(`/api/owner/calendar?month=${month}`),
    decide: (id: string, action: 'confirm' | 'reject', reason?: string) =>
      request<{ booking: OwnerBooking; conflicts: Busy[] }>(`/api/owner/bookings/${id}/decide`, {
        ...post({ action, reason }),
        admin: true,
      }),
    cancel: (id: string, reason?: string) =>
      request<{ booking: OwnerBooking }>(`/api/owner/bookings/${id}/cancel`, { ...post({ reason }), admin: true }),
    addBusy: (body: AddBusyBody) =>
      request<{ created: number; conflicts: OwnerBooking[] }>('/api/owner/busy', { ...post(body), admin: true }),
    removeBusy: (id: string) => request<{ removed: number }>(`/api/owner/busy/${id}`, { method: 'DELETE', admin: true }),
    removeSeries: (seriesId: string) =>
      request<{ removed: number }>(`/api/owner/busy-series/${seriesId}`, { method: 'DELETE', admin: true }),
    settings: () => request<Settings>('/api/owner/settings'),
    saveSettings: (body: { siteTitle?: string; bookingUntil?: string }) =>
      request<Settings>('/api/owner/settings', { method: 'PUT', body: JSON.stringify(body), admin: true }),
  },
};

// ---------- 브라우저 저장 (실패해도 화면은 동작) ----------
const TOKENS_KEY = 'meet.tokens';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* 저장 못 해도 계속 진행 */
  }
}

export const local = {
  tokens(): string[] {
    try {
      const v = JSON.parse(read(TOKENS_KEY) ?? '[]');
      return Array.isArray(v) ? v.filter((t) => typeof t === 'string') : [];
    } catch {
      return [];
    }
  },
  addTokens(tokens: string[]) {
    const set = new Set([...local.tokens(), ...tokens]);
    write(TOKENS_KEY, JSON.stringify([...set].slice(-100)));
  },
};
