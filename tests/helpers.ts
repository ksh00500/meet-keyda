import { openDb } from '../server/db.js';
import { Store } from '../server/store.js';
import { createApp } from '../server/app.js';

/** 2026-11-21(토) 12:00 KST 로 고정 */
export const FIXED_NOW = new Date('2026-11-21T03:00:00Z');
export const OWNER_KEY = 'test-owner-key-0123456789abcdef';

export function makeStore(now: Date = FIXED_NOW, until: string | null = null) {
  let current = now;
  const clock = () => current;
  const store = new Store(openDb(':memory:'), clock, until);
  return { store, clock, setNow: (d: Date) => (current = d) };
}

export function makeApp(now: Date = FIXED_NOW) {
  const s = makeStore(now);
  const app = createApp({ store: s.store, ownerKey: OWNER_KEY, siteTitle: '시호와 약속 잡기', clock: s.clock });
  return { ...s, app };
}

export const owner = { Authorization: `Bearer ${OWNER_KEY}`, 'Content-Type': 'application/json' };
export const jsonHeaders = { 'Content-Type': 'application/json' };
