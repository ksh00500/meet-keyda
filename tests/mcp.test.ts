import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { OWNER_KEY, jsonHeaders, makeApp } from './helpers.js';

async function connect(app: ReturnType<typeof makeApp>['app'], key = OWNER_KEY) {
  const transport = new StreamableHTTPClientTransport(new URL('http://test.local/mcp'), {
    fetch: (url, init) => app.request(String(url), init as RequestInit),
    requestInit: { headers: { Authorization: `Bearer ${key}` } },
  });
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

function parse(res: unknown) {
  const r = res as { content: { text: string }[]; isError?: boolean };
  if (r.isError) throw new Error(r.content[0].text);
  return JSON.parse(r.content[0].text);
}

describe('MCP', () => {
  it('토큰이 틀리면 연결 안 됨 (401)', async () => {
    const { app } = makeApp();
    const r = await app.request('/mcp', { method: 'POST', headers: jsonHeaders, body: '{}' });
    expect(r.status).toBe(401);
    await expect(connect(app, 'wrong-key')).rejects.toThrow();
  });

  it('도구 6개가 보임', async () => {
    const { app } = makeApp();
    const client = await connect(app);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ['add_busy', 'cancel_booking', 'decide_request', 'get_schedule', 'list_requests', 'remove_busy'].sort(),
    );
    await client.close();
  });

  it('흐름 B·C: 일정 등록 → 친구 화면 반영 → 신청 조회 → 수락 → 확정 취소', async () => {
    const { app } = makeApp();
    const client = await connect(app);

    const added = parse(
      await client.callTool({
        name: 'add_busy',
        arguments: {
          blocks: [
            { start: '2026-12-01T19:00', end: '2026-12-01T22:00', title: '회의' },
            { start: '2026-12-03T19:00', end: '2026-12-03T22:00', title: '회의' },
            { start: '2026-12-05T00:00', end: '2026-12-06T00:00', title: '여행' },
          ],
        },
      }),
    );
    expect(added.createdCount).toBe(3);

    const cal = await (await app.request('/api/calendar?month=2026-12')).json();
    expect(cal.days.find((d: { date: string }) => d.date === '2026-12-05').state).toBe('full');
    expect(JSON.stringify(cal)).not.toContain('여행');

    const r = await app.request('/api/bookings', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ date: '2026-12-02', slot: 'lunch', name: '김민지', pin: '1234', memo: '파스타 어때' }),
    });
    const { id } = await r.json();

    const reqs = parse(await client.callTool({ name: 'list_requests', arguments: {} }));
    expect(reqs.requests[0]).toMatchObject({ id, name: '김민지', memo: '파스타 어때', status: 'pending' });

    const decided = parse(await client.callTool({ name: 'decide_request', arguments: { id, action: 'confirm' } }));
    expect(decided.booking.status).toBe('confirmed');

    const sched = parse(await client.callTool({ name: 'get_schedule', arguments: { from: '2026-12-01', to: '2026-12-07' } }));
    expect(sched.today).toBe('2026-11-21');
    expect(sched.busy.length).toBe(3);
    expect(sched.bookings[0].status).toBe('confirmed');

    // 겹친 신청 알림
    const clash = parse(
      await client.callTool({ name: 'add_busy', arguments: { blocks: [{ start: '2026-12-02T12:00', end: '2026-12-02T13:00' }] } }),
    );
    expect(clash.conflicts.map((c: { id: string }) => c.id)).toEqual([id]);

    const cancelled = parse(await client.callTool({ name: 'cancel_booking', arguments: { id, reason: '급한 일정' } }));
    expect(cancelled.booking).toMatchObject({ status: 'cancelled', reason: '급한 일정' });
    await client.close();
  });

  it('반복 일정 등록과 묶음 삭제, 잘못된 입력은 isError', async () => {
    const { app } = makeApp();
    const client = await connect(app);
    const rep = parse(
      await client.callTool({
        name: 'add_busy',
        arguments: { repeat: { weekdays: [2], startTime: '19:00', endTime: '22:00', from: '2026-12-01', until: '2026-12-31', title: '스터디' } },
      }),
    );
    expect(rep.createdCount).toBe(5);
    const rm = parse(await client.callTool({ name: 'remove_busy', arguments: { seriesId: rep.seriesId } }));
    expect(rm.removed).toBe(5);
    const bad = (await client.callTool({ name: 'add_busy', arguments: {} })) as { isError?: boolean };
    expect(bad.isError).toBe(true);
    await client.close();
  });
});
