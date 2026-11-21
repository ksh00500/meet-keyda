# meet-keyda · 시호와 약속 잡기

내가 안 되는 시간이 표시된 캘린더를 친구에게 링크로 보내면, 친구가 빈 날짜를 눌러 약속을 신청합니다. 신청은 "신청 중"으로 들어오고, 내가 수락해야 "확정"이 됩니다. 내 일정 등록과 신청 처리는 AI(Grok 등)가 MCP로 대신합니다.

- 친구 화면: `https://meet.keyda.site/`
- 내 신청: `https://meet.keyda.site/mine`
- 주인 화면: `https://meet.keyda.site/owner` (비밀 키 필요)
- MCP: `https://meet.keyda.site/mcp` (Bearer 토큰 = 비밀 키)

## 기능

| 누가 | 할 수 있는 것 |
| --- | --- |
| 친구 | 월간 캘린더 보기 (불가·예약됨만 보이고 이유·이름은 안 보임) |
| 친구 | 점심 11:30–14:00 · 저녁 18:00–22:00 · 오전 반일 09:00–13:00 · 오후 반일 13:00–18:00 · 종일 09:00–22:00 · 직접 선택(30분 단위) 중 골라 신청 |
| 친구 | 이름 + PIN 4자리로 신청. 다른 기기에서도 이름 + PIN으로 내 신청 확인·취소 (5번 틀리면 10분 잠금) |
| 주인 | `/owner`에서 신청 수락·거절·확정 취소, 불가능 시간 확인·삭제 |
| 주인의 AI | MCP 도구로 일정 조회, 불가능 시간 등록(반복 포함)·삭제, 신청 목록·수락·거절·취소 |

규칙: 신청은 내일부터 90일까지만 받습니다. 한국 시간 기준이고, 불가능 시간·신청 중·확정 약속과 겹치는 시간은 고를 수 없습니다.

## 개인 서버에 배포하기 (Docker + Cloudflare 터널)

서버 포트를 밖으로 열지 않고, Cloudflare 터널로 `meet.keyda.site`를 연결합니다.

### 1. Cloudflare에서 터널 만들기 (처음 한 번)

1. Cloudflare 대시보드 → **Zero Trust** → **Networks** → **Tunnels** → **Create a tunnel** → **Cloudflared** 선택
2. 이름을 정하고(예: `meet`) 저장하면 설치 명령이 나옵니다. 명령의 `--token` 뒤에 있는 긴 값을 복사해 둡니다. 이 값이 `TUNNEL_TOKEN`입니다. 다른 사람에게 보여 주지 마세요.
3. **Public Hostname** 추가
   - Subdomain: `meet`, Domain: `keyda.site`
   - Service: `HTTP` · `app:3000`

### 2. 서버에서 실행

```bash
git clone https://github.com/ksh00500/meet-keyda.git
cd meet-keyda
cp .env.example .env
```

`.env`를 열어 값을 채웁니다.

```bash
openssl rand -hex 32   # 이 출력값을 OWNER_KEY에 넣기
```

| 변수 | 값 |
| --- | --- |
| `OWNER_KEY` | 위에서 만든 64자 값. 주인 화면 비밀 키이자 MCP Bearer 토큰 |
| `TUNNEL_TOKEN` | 1번에서 복사한 터널 토큰 |
| `SITE_TITLE` | 화면 제목 (기본 "시호와 약속 잡기") |
| `SEED_DEMO` | 비워 두기. `1`이면 빈 DB에 예시 데이터를 넣음 (점검용) |

```bash
docker compose up -d --build
docker compose ps        # app 이 healthy 인지 확인
curl -s http://127.0.0.1:3000/api/health   # {"ok":true}
```

이제 `https://meet.keyda.site`가 열립니다.

### 업데이트

```bash
git pull && docker compose up -d --build
```

DB는 Docker 볼륨 `meet-data`에 남아서 업데이트해도 지워지지 않습니다.

### 백업

```bash
docker compose exec app node -e "require('better-sqlite3')('/data/meet.db').backup('/data/backup.db').then(()=>console.log('ok'))"
docker compose cp app:/data/backup.db ./meet-backup-$(date +%F).db
```

## Grok(또는 다른 AI)에 MCP 연결하기

원격 서버 방식으로 등록합니다.

| 항목 | 값 |
| --- | --- |
| MCP 주소 | `https://meet.keyda.site/mcp` |
| 인증 | Bearer 토큰 (헤더 `Authorization: Bearer <OWNER_KEY>`) |
| 전송 방식 | Streamable HTTP |

비밀 키는 AI 설정 화면에 직접 넣으세요. 채팅창에 붙여 넣지 마세요.

### 도구

| 도구 | 하는 일 | 예시 말 |
| --- | --- | --- |
| `get_schedule` | 기간의 내 일정과 신청 조회 | "이번 주 일정 보여줘" |
| `add_busy` | 불가능 시간 등록 (여러 개, 반복 가능). 겹친 신청을 알려 줌 | "다음 주 화·목 저녁 7시부터 10시 회의", "12월 매주 화요일 19–22시 스터디" |
| `remove_busy` | 불가능 시간 삭제 (하나 또는 반복 묶음 전체) | "목요일 회의 취소됐어, 지워줘" |
| `list_requests` | 신청 목록 (기본: 신청 중) | "새로 들어온 약속 있어?" |
| `decide_request` | 수락·거절 (거절 메시지 선택) | "민지 건 수락하고 서연 건은 거절해" |
| `cancel_booking` | 확정 약속 취소 | "금요일 준호랑 약속 취소해줘, 사유는 야근" |

MCP는 AI가 물어볼 때 답하는 구조라서, 새 신청이 들어와도 AI가 먼저 알려 주지는 않습니다. "새 약속 있어?"라고 물어보세요. 주인 화면 맨 위에도 "새 신청 N건"이 보입니다.

### 연결이 안 될 때

- 401: Bearer 토큰이 `.env`의 `OWNER_KEY`와 다릅니다.
- 403 또는 Cloudflare 확인 페이지: Cloudflare의 봇 차단(Bot Fight Mode 등)이 Grok 서버 접속을 막는 경우입니다. Security 설정에서 `meet.keyda.site/mcp` 경로를 예외로 두세요.

## 개발

```bash
npm install
npm test                      # 테스트
OWNER_KEY=local-dev-key-0123456789abcdef SEED_DEMO=1 npm run dev
# 화면 http://localhost:5173 , API·MCP http://localhost:3000
```

| 폴더 | 내용 |
| --- | --- |
| `server/domain` | 시간대·겹침·반복 규칙 (화면과 같이 씀) |
| `server/store.ts` | DB 읽기·쓰기 |
| `server/app.ts` | 친구·주인 API, `/mcp` |
| `server/mcp` | MCP 도구 |
| `web/` | React 화면 |
| `sprint/` | 기획·설계·개발 기록 (WORKFLO 경량판) |

## 보안 메모

- `OWNER_KEY`, `TUNNEL_TOKEN`은 서버의 `.env`에만 둡니다. `.env`는 커밋하지 않습니다.
- 친구 API 응답에는 일정 제목, 다른 친구의 이름·메모가 들어가지 않습니다.
- PIN은 scrypt 해시로만 저장합니다. 이름 + PIN은 "내 신청 다시 찾기"용이며 본인 인증은 아닙니다.
- 로그인이 없어서 누구나 아무 이름으로 신청할 수 있습니다. 수락할 때 확인하세요.
