#!/usr/bin/env bash
# Cloudflare 터널을 명령어로 만듭니다 (Zero Trust 대시보드 없이). 서버에서 한 번만 실행.
#   ./scripts/tunnel-setup.sh [터널이름] [주소]
# 기본값: 터널이름 meet, 주소 meet.keyda.site
# 결과: cloudflared/ 안에 cert.pem(계정 인증서), <터널ID>.json(터널 자격 증명), config.yml
# 이 파일들은 비밀이라 .gitignore 되어 있습니다. 절대 커밋하지 마세요.
set -euo pipefail

NAME="${1:-meet}"
HOST="${2:-meet.keyda.site}"
IMAGE="cloudflare/cloudflared:latest"
DIR="$(cd "$(dirname "$0")/.." && pwd)/cloudflared"
mkdir -p "$DIR"

# 서버 사용자와 같은 uid로 실행해야 만든 파일을 나중에 chmod 할 수 있다
cf() {
  docker run --rm ${TTY:-} --user "$(id -u):$(id -g)" -e HOME=/home/nonroot \
    -v "$DIR:/home/nonroot/.cloudflared" "$IMAGE" "$@"
}

if [ ! -f "$DIR/cert.pem" ]; then
  echo "1/3 Cloudflare 로그인: 아래에 나오는 주소를 브라우저에서 열고 keyda.site 를 고르세요."
  TTY="-it" cf tunnel login
else
  echo "1/3 이미 로그인되어 있습니다 (cloudflared/cert.pem)."
fi

if ls "$DIR"/*-*-*-*-*.json >/dev/null 2>&1; then
  CRED="$(ls "$DIR"/*-*-*-*-*.json | head -n 1)"
  echo "2/3 이미 만든 터널이 있습니다: $(basename "$CRED")"
else
  echo "2/3 터널 '$NAME' 만들기"
  cf tunnel create "$NAME"
  CRED="$(ls "$DIR"/*-*-*-*-*.json | head -n 1)"
fi
ID="$(basename "$CRED" .json)"

echo "3/3 $HOST → 터널 연결 (DNS CNAME 기록 추가)"
cf tunnel route dns "$ID" "$HOST" || echo "  (이미 연결되어 있으면 이 오류는 무시해도 됩니다)"

sed -e "s/<TUNNEL_ID>/$ID/g" -e "s/meet\.keyda\.site/$HOST/" "$DIR/config.example.yml" > "$DIR/config.yml"

# cloudflared 컨테이너는 nonroot 사용자로 돌기 때문에 읽을 수 있게 권한을 맞춘다.
chmod 755 "$DIR"
if ! chmod 644 "$DIR/config.yml" "$CRED" 2>/dev/null; then
  echo
  echo "권한을 바꾸지 못했습니다 (예전 버전 스크립트가 root로 만든 파일). 아래 두 줄을 실행하세요:"
  echo "  sudo chown -R \$(id -u):\$(id -g) \"$DIR\""
  echo "  chmod 644 \"$DIR/config.yml\" \"$CRED\""
  exit 1
fi
chmod 600 "$DIR/cert.pem" 2>/dev/null || true

echo
echo "완료. 터널 ID: $ID"
echo "이제: docker compose up -d --build"
