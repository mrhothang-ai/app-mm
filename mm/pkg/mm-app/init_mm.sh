#!/bin/bash
# Tao superuser PocketBase + tai khoan Quan tri app dau tien. Doc mm_init.env roi xoa ngay.
cd "$(dirname "$0")"
CONTAINER=${CONTAINER:-pb_mm_app}
DOCKER=${DOCKER:-docker}
if [ ! -f mm_init.env ]; then echo "  [INFO] Khong co mm_init.env - bo qua buoc tao tai khoan"; exit 0; fi
# shellcheck disable=SC1091
. ./mm_init.env; rm -f mm_init.env
PORT=$(grep -E '^MM_PORT=' .env 2>/dev/null | cut -d= -f2); PORT=${PORT:-8097}
BASE=${BASE:-http://127.0.0.1:$PORT}
echo "=== TAO TAI KHOAN ==="
if $DOCKER exec "$CONTAINER" /pb/pocketbase superuser upsert "$SU_EMAIL" "$SU_PASS" >/dev/null 2>&1; then echo "  [OK]   Superuser PocketBase: $SU_EMAIL (khong can mo link pbinstall nua)";
else echo "  [LOI]  Khong tao duoc superuser - chay tay: docker exec $CONTAINER /pb/pocketbase superuser upsert EMAIL MATKHAU"; exit 1; fi
if ! command -v curl >/dev/null 2>&1; then echo "  [CANH BAO] Khong co curl - tao tai khoan admin app bang tay (HUONGDAN muc 3)"; exit 0; fi
json() { sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }
E=$(printf '%s' "$SU_EMAIL" | json); P=$(printf '%s' "$SU_PASS" | json)
TOKEN=$(curl -s -X POST "$BASE/api/collections/_superusers/auth-with-password" -H 'Content-Type: application/json' \
  -d "{\"identity\":\"$E\",\"password\":\"$P\"}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
if [ -z "$TOKEN" ]; then echo "  [LOI]  Dang nhap superuser that bai - tao admin app bang tay (HUONGDAN muc 3)"; exit 1; fi
U=$(printf '%s' "$ADMIN_USER" | tr '[:lower:]' '[:upper:]'); N=$(printf '%s' "${ADMIN_NAME:-Quan tri}" | json); AP=$(printf '%s' "$ADMIN_PASS" | json)
FOUND=$(curl -s -G "$BASE/api/collections/users/records" -H "Authorization: $TOKEN" --data-urlencode "filter=username='$U'" | grep -o '"totalItems":[0-9]*' | cut -d: -f2)
if [ "${FOUND:-0}" -gt 0 ]; then echo "  [OK]   Tai khoan app $U da co - giu nguyen (khong doi mat khau)";
else
  R=$(curl -s -o /tmp/mm_init_out -w '%{http_code}' -X POST "$BASE/api/collections/users/records" -H "Authorization: $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"username\":\"$U\",\"name\":\"$N\",\"role\":\"admin\",\"active\":true,\"password\":\"$AP\",\"passwordConfirm\":\"$AP\"}")
  if [ "$R" = 200 ]; then echo "  [OK]   Tai khoan Quan tri app: Ma NV $U (dang nhap bang mat khau vua nhap)";
  else echo "  [LOI]  Tao tai khoan app that bai ($R): $(head -c 300 /tmp/mm_init_out)"; rm -f /tmp/mm_init_out; exit 1; fi
  rm -f /tmp/mm_init_out
fi
KEY=$(grep -E '^MM_API_KEY=' .env 2>/dev/null | cut -d= -f2)
[ -n "$KEY" ] && echo "  [INFO] Khoa API day PO (X-MM-Key): $KEY"
echo "=== MMSETUP_DONE ==="
