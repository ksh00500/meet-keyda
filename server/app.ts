import { createHash, timingSafeEqual } from 'node:crypto';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { SLOTS, bookableRange, nowKst } from './domain/time.js';
import { createMcpServer } from './mcp/server.js';
import type { BookingStatus, Fail, Store } from './store.js';

export interface AppOptions {
  store: Store;
  ownerKey: string;
  siteTitle: string;
  clock?: () => Date;
}

const STATUSES = ['pending', 'confirmed', 'rejected', 'cancelled', 'all'] as const;

function keyMatches(given: string, expected: string): boolean {
  // 길이가 달라도 같은 시간이 걸리도록 해시를 비교한다.
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function bearer(c: Context): string {
  const h = c.req.header('authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : '';
}

function sendFail(c: Context, f: Fail & { retryAfterSec?: number }) {
  const body: Record<string, unknown> = { error: f.error, message: f.message };
  if (f.retryAfterSec !== undefined) body.retryAfterSec = f.retryAfterSec;
  return c.json(body, (f.status ?? 400) as 400);
}

async function readJson(c: Context): Promise<Record<string, unknown>> {
  try {
    const v = await c.req.json();
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** 아주 단순한 메모리 속도 제한 (IP별). 장난 신청을 줄이기 위한 것 */
function rateLimit(limit: number, windowMs: number): MiddlewareHandler {
  const hits = new Map<string, { n: number; reset: number }>();
  return async (c, next) => {
    const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
    const now = Date.now();
    const h = hits.get(ip);
    if (!h || h.reset < now) {
      hits.set(ip, { n: 1, reset: now + windowMs });
      if (hits.size > 5000) hits.clear();
    } else if (++h.n > limit) {
      return c.json({ error: 'too_many', message: '요청이 너무 많아요. 잠시 후 다시 시도해 주세요' }, 429);
    }
    await next();
  };
}

export function createApp({ store, ownerKey, siteTitle, clock = () => new Date() }: AppOptions) {
  const app = new Hono();

  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Frame-Options', 'DENY');
  });

  const ownerOnly: MiddlewareHandler = async (c, next) => {
    if (!ownerKey || !keyMatches(bearer(c), ownerKey)) {
      return c.json({ error: 'unauthorized', message: '키가 맞지 않아요' }, 401, {
        'WWW-Authenticate': 'Bearer',
      });
    }
    await next();
  };

  // ---------- 친구 ----------
  app.get('/api/health', (c) => c.json({ ok: true }));

  app.get('/api/config', (c) => {
    const { from, to } = bookableRange(clock());
    return c.json({ title: siteTitle, today: nowKst(clock()).date, bookableFrom: from, bookableTo: to, slots: SLOTS });
  });

  app.get('/api/calendar', (c) => {
    const month = c.req.query('month') ?? nowKst(clock()).date.slice(0, 7);
    const r = store.calendar(month);
    if ('ok' in r) return sendFail(c, r);
    return c.json(r);
  });

  app.post('/api/bookings', rateLimit(20, 60 * 60_000), async (c) => {
    const body = await readJson(c);
    const r = store.createBooking({
      date: body.date,
      slot: body.slot,
      start: body.start,
      end: body.end,
      name: body.name,
      pin: body.pin,
      memo: body.memo,
    });
    if (!r.ok) return sendFail(c, r);
    return c.json({ ...r.booking, token: r.token }, 201);
  });

  app.post('/api/bookings/mine', async (c) => {
    const body = await readJson(c);
    return c.json({ bookings: store.bookingsByTokens(body.tokens) });
  });

  app.post('/api/bookings/lookup', rateLimit(30, 10 * 60_000), async (c) => {
    const body = await readJson(c);
    const r = store.lookup(body.name, body.pin);
    if (!r.ok) return sendFail(c, r);
    return c.json({ bookings: r.bookings });
  });

  app.post('/api/bookings/:id/cancel', async (c) => {
    const body = await readJson(c);
    const r = store.cancelByFriend(c.req.param('id'), body.tokens ?? body.token);
    if (!r.ok) return sendFail(c, r);
    return c.json(r.booking);
  });

  // ---------- 주인 ----------
  app.use('/api/owner/*', ownerOnly);

  app.get('/api/owner/summary', (c) => c.json(store.summary()));

  app.get('/api/owner/bookings', (c) => {
    const s = c.req.query('status') ?? 'all';
    const status = (STATUSES as readonly string[]).includes(s) ? (s as BookingStatus | 'all') : 'all';
    return c.json({ bookings: store.listBookings({ status, includePast: c.req.query('past') === '1' }) });
  });

  app.post('/api/owner/bookings/:id/decide', async (c) => {
    const body = await readJson(c);
    if (body.action !== 'confirm' && body.action !== 'reject') {
      return c.json({ error: 'bad_action', message: 'action은 confirm 또는 reject' }, 400);
    }
    const r = store.decide(c.req.param('id'), body.action, typeof body.reason === 'string' ? body.reason : undefined);
    if (!r.ok) return sendFail(c, r);
    return c.json({ booking: r.booking, conflicts: r.conflicts });
  });

  app.post('/api/owner/bookings/:id/cancel', async (c) => {
    const body = await readJson(c);
    const r = store.cancelBooking(c.req.param('id'), typeof body.reason === 'string' ? body.reason : undefined);
    if (!r.ok) return sendFail(c, r);
    return c.json({ booking: r.booking });
  });

  app.get('/api/owner/busy', (c) => {
    const today = nowKst(clock()).date;
    const r = store.schedule(c.req.query('from') ?? today, c.req.query('to') ?? bookableRange(clock()).to);
    if (!r.ok) return sendFail(c, r);
    return c.json({ busy: r.busy });
  });

  app.delete('/api/owner/busy/:id', (c) => {
    const r = store.removeBusy({ id: c.req.param('id') });
    if (!r.ok) return sendFail(c, r);
    return c.json(r);
  });

  app.delete('/api/owner/busy-series/:seriesId', (c) => {
    const r = store.removeBusy({ seriesId: c.req.param('seriesId') });
    if (!r.ok) return sendFail(c, r);
    return c.json(r);
  });

  // ---------- MCP ----------
  // 상태를 기억하지 않는 방식: 요청마다 서버와 전송 객체를 새로 만든다.
  app.all('/mcp', ownerOnly, async (c) => {
    const server = createMcpServer(store, siteTitle, clock);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      // JSON 응답 모드라 응답이 만들어진 뒤 바로 닫아도 된다.
      void transport.close();
      void server.close();
    }
  });

  app.all('/api/*', (c) => c.json({ error: 'not_found', message: '없는 주소예요' }, 404));

  return app;
}
