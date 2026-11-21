import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { openDb } from './db.js';
import { seedDemo } from './seed.js';
import { Store } from './store.js';

const ownerKey = process.env.OWNER_KEY ?? '';
const siteTitle = process.env.SITE_TITLE?.trim() || '시호와 약속 잡기';
const dbPath = process.env.DB_PATH ?? resolve('data/meet.db');
const port = Number(process.env.PORT ?? 3000);
const webDir = resolve(process.env.WEB_DIR ?? 'dist/web');
const bookingUntil = process.env.BOOKING_UNTIL?.trim() || null;
if (bookingUntil && !/^\d{4}-\d{2}-\d{2}$/.test(bookingUntil)) {
  console.error('BOOKING_UNTIL은 YYYY-MM-DD 형식이어야 합니다. 예: 2027-01-24');
  process.exit(1);
}

if (ownerKey.length < 24) {
  console.error('OWNER_KEY가 없거나 너무 짧습니다 (24자 이상). 예: openssl rand -hex 32 로 만든 값을 .env에 넣으세요.');
  process.exit(1);
}

const db = openDb(dbPath);
const store = new Store(db, undefined, bookingUntil);
if (process.env.SEED_DEMO === '1' && seedDemo(store)) console.log('예시 데이터를 넣었습니다 (SEED_DEMO=1).');

const app = createApp({ store, ownerKey, siteTitle });

if (existsSync(webDir)) {
  const indexHtml = readFileSync(resolve(webDir, 'index.html'), 'utf8').replaceAll('%SITE_TITLE%', escapeHtml(siteTitle));
  app.use('/assets/*', serveStatic({ root: webDir }));
  app.use('/favicon.svg', serveStatic({ root: webDir }));
  // 화면 주소(/, /mine, /owner)는 모두 같은 index.html을 보낸다.
  app.get('*', (c) => c.html(indexHtml));
} else {
  console.warn(`화면 파일이 없습니다 (${webDir}). npm run build:web 을 먼저 실행하세요. API와 MCP만 동작합니다.`);
}

const server = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
  console.log(`${siteTitle} · http://localhost:${info.port} (MCP: /mcp)`);
});

function shutdown() {
  server.close();
  db.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}
