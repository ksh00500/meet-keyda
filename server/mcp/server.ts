import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SLOTS, bookableRange, nowKst } from '../domain/time.js';
import type { Store } from '../store.js';

const TIME_NOTE =
  '시간은 모두 한국 시간(Asia/Seoul) 문자열 "YYYY-MM-DDTHH:MM"입니다. 구간은 시작 포함·끝 제외이며, 하루 끝(24:00)은 다음 날 "T00:00"으로 씁니다.';
const SLOT_NOTE = `친구가 고르는 기본 시간대: ${SLOTS.map((s) => `${s.label} ${s.start}-${s.end}`).join(', ')}. 친구는 30분 단위로 직접 시간을 고를 수도 있습니다.`;

const stampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/)
  .describe('YYYY-MM-DDTHH:MM (한국 시간)');
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('YYYY-MM-DD');

function json(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

export function createMcpServer(store: Store, siteTitle: string, clock: () => Date = () => new Date()): McpServer {
  const server = new McpServer(
    { name: 'meet-keyda', version: '0.1.0' },
    {
      instructions: [
        `"${siteTitle}" 서비스의 주인 전용 도구입니다. 주인의 불가능 시간(일정)을 등록·조회하고, 친구들이 보낸 약속 신청을 확인·수락·거절합니다.`,
        TIME_NOTE,
        SLOT_NOTE,
        '친구 신청은 "pending(신청 중)"으로 들어오고 주인이 수락해야 "confirmed(확정)"가 됩니다. 거절(rejected)이나 취소(cancelled)된 신청은 시간을 막지 않습니다.',
        '주인이 "다음 주 화요일 저녁" 같은 말을 하면 오늘 날짜(get_schedule 결과의 today)를 기준으로 정확한 시각으로 바꿔서 쓰세요. 수락·거절·삭제처럼 되돌리기 어려운 동작은 주인이 분명히 말했을 때만 하세요.',
      ].join('\n'),
    },
  );

  server.registerTool(
    'get_schedule',
    {
      title: '일정 조회',
      description: `기간(양 끝 날짜 포함)의 내 불가능 시간(제목 포함)과 친구 신청(이름·메모·상태 포함)을 시간순으로 돌려줍니다. 오늘 날짜와 친구가 신청할 수 있는 기간도 함께 줍니다. ${TIME_NOTE}`,
      inputSchema: {
        from: dateSchema,
        to: dateSchema,
        includeInactive: z.boolean().optional().describe('true면 거절·취소된 신청도 포함'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ from, to, includeInactive }) => {
      const r = store.schedule(from, to, includeInactive ?? false);
      if (!r.ok) return fail(r.message);
      return json({ today: nowKst(clock()).date, bookableRange: bookableRange(clock()), ...r, ok: undefined });
    },
  );

  server.registerTool(
    'add_busy',
    {
      title: '불가능 시간 등록',
      description: `내가 안 되는 시간을 등록합니다. 친구 화면에는 이유 없이 "불가"로만 보입니다. blocks(구간 목록) 또는 repeat(반복 규칙) 중 하나를 주세요. 이미 친구 신청이 걸린 시간과 겹쳐도 등록되며, 겹친 신청 목록(conflicts)을 돌려주니 주인에게 꼭 알려 주세요. ${TIME_NOTE}`,
      inputSchema: {
        blocks: z
          .array(z.object({ start: stampSchema, end: stampSchema, title: z.string().max(100).optional() }))
          .max(200)
          .optional()
          .describe('등록할 구간 목록. 예: [{"start":"2026-12-01T19:00","end":"2026-12-01T22:00","title":"회의"}]. 종일이면 그날 T00:00부터 다음 날 T00:00까지'),
        repeat: z
          .object({
            weekdays: z.array(z.number().int().min(0).max(6)).min(1).describe('0=일, 1=월, … 6=토'),
            startTime: z.string().regex(/^\d{2}:\d{2}$/).describe('HH:MM'),
            endTime: z.string().regex(/^\d{2}:\d{2}$/).describe('HH:MM, 자정까지면 24:00'),
            from: dateSchema,
            until: dateSchema,
            title: z.string().max(100).optional(),
          })
          .optional()
          .describe('반복 일정. 예: 매주 화요일 19-22시를 12월 말까지 → {"weekdays":[2],"startTime":"19:00","endTime":"22:00","from":"2026-12-01","until":"2026-12-31"}'),
      },
    },
    async ({ blocks, repeat }) => {
      if (!!blocks === !!repeat) return fail('blocks와 repeat 중 정확히 하나만 주세요.');
      if (repeat) {
        const { title, ...rule } = repeat;
        const r = store.addRepeat(rule, title);
        if (!r.ok) return fail(r.message);
        return json({ seriesId: r.seriesId, createdCount: r.created.length, created: r.created, conflicts: r.conflicts });
      }
      const r = store.addBusy(blocks!);
      if (!r.ok) return fail(r.message);
      return json({ createdCount: r.created.length, created: r.created, conflicts: r.conflicts });
    },
  );

  server.registerTool(
    'remove_busy',
    {
      title: '불가능 시간 삭제',
      description: '등록한 불가능 시간을 지웁니다. id(하나) 또는 seriesId(반복으로 만든 묶음 전체) 중 하나를 주세요. 지우면 친구 화면에서 그 시간이 다시 열립니다.',
      inputSchema: { id: z.string().optional(), seriesId: z.string().optional() },
      annotations: { destructiveHint: true },
    },
    async ({ id, seriesId }) => {
      if (!!id === !!seriesId) return fail('id와 seriesId 중 정확히 하나만 주세요.');
      const r = store.removeBusy({ id, seriesId });
      if (!r.ok) return fail(r.message);
      return json({ removed: r.removed });
    },
  );

  server.registerTool(
    'list_requests',
    {
      title: '약속 신청 목록',
      description: '친구들의 약속 신청을 상태별로 돌려줍니다. 기본은 아직 처리하지 않은 신청(pending)입니다. "새로 들어온 약속 있어?"에 이 도구를 쓰세요.',
      inputSchema: {
        status: z.enum(['pending', 'confirmed', 'rejected', 'cancelled', 'all']).optional(),
        includePast: z.boolean().optional().describe('true면 이미 지난 약속도 포함'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ status, includePast }) => {
      const list = store.listBookings({ status: status ?? 'pending', includePast: includePast ?? false });
      return json({ count: list.length, requests: list });
    },
  );

  server.registerTool(
    'decide_request',
    {
      title: '신청 수락·거절',
      description: '신청 중(pending)인 약속을 수락(confirm)하거나 거절(reject)합니다. 거절 사유는 친구 화면에 보입니다. 수락한 약속이 내 불가능 시간과 겹치면 conflicts로 알려 줍니다.',
      inputSchema: {
        id: z.string(),
        action: z.enum(['confirm', 'reject']),
        reason: z.string().max(100).optional().describe('친구에게 보일 짧은 메시지 (선택)'),
      },
    },
    async ({ id, action, reason }) => {
      const r = store.decide(id, action, reason);
      if (!r.ok) return fail(r.message);
      return json({ booking: r.booking, conflicts: r.conflicts });
    },
  );

  server.registerTool(
    'cancel_booking',
    {
      title: '약속 취소',
      description: '신청 중이거나 확정된 약속을 주인 쪽에서 취소합니다. 취소하면 그 시간이 다시 열리고, 친구 화면에 "취소됨"과 사유가 보입니다.',
      inputSchema: {
        id: z.string(),
        reason: z.string().max(100).optional().describe('친구에게 보일 짧은 사유 (선택)'),
      },
      annotations: { destructiveHint: true },
    },
    async ({ id, reason }) => {
      const r = store.cancelBooking(id, reason);
      if (!r.ok) return fail(r.message);
      return json({ booking: r.booking });
    },
  );

  return server;
}
