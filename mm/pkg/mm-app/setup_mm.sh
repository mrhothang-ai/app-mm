#!/bin/bash
# Dung / cap nhat app Kitting vat lieu (MM) tren PocketBase. Chay lai nhieu lan an toan.
set -e
cd "$(dirname "$0")"
echo "=== App Kitting (MM) -> $(pwd) ==="
[ -f .env ] || cp env.default .env
if ! grep -qE '^MM_API_KEY=.{16,}' .env; then
  KEY=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
  if grep -q '^MM_API_KEY=' .env; then sed -i "s/^MM_API_KEY=.*/MM_API_KEY=$KEY/" .env; else echo "MM_API_KEY=$KEY" >> .env; fi
  echo "=== Da tao khoa API moi (xem file .env tren server): $KEY ==="
fi
if [ ! -f pocketbase ]; then
  if [ -f ../app_org/pocketbase ]; then cp ../app_org/pocketbase ./pocketbase
  else echo "THIEU file pocketbase - chep tu ../app_org/pocketbase"; exit 1; fi
fi
chmod +x pocketbase
mkdir -p pb_data pb_hooks pb_public pb_migrations
PORT=$(grep -E '^MM_PORT=' .env | cut -d= -f2); PORT=${PORT:-8097}
WAS=$(docker ps -q -f name='^pb_mm_app$' || true)
if [ -z "$WAS" ] && (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep -qE "[:.]$PORT\s"; then
  echo "CONG $PORT DANG BI APP KHAC DUNG. Sua MM_PORT trong .env roi chay lai."; exit 1
fi
docker compose up -d --build
if [ -n "$WAS" ]; then docker restart pb_mm_app >/dev/null; fi   # nap migration / hook moi
S=none
for i in $(seq 1 30); do
  S=$(docker inspect -f '{{.State.Health.Status}}' pb_mm_app 2>/dev/null || echo none)
  [ "$S" = healthy ] && break; sleep 3
done
echo "=== Trang thai container: $S ==="
docker logs pb_mm_app --tail 25 2>&1
if [ "$S" != healthy ]; then echo "=== CONTAINER CHUA HEALTHY - xem log o tren (docker logs pb_mm_app --tail 60) ==="; exit 1; fi
IP=$(hostname -I | awk '{print $1}')
echo "=== Trang app: http://$IP:$PORT/    Admin: http://$IP:$PORT/_/ ==="
TOKEN=$(docker logs pb_mm_app 2>&1 | grep -o 'pbinstall/[A-Za-z0-9._-]*' | tail -1 || true)
[ -n "$TOKEN" ] && [ -z "$MM_FROM_SETUP" ] && echo "=== Tao superuser dau tien: http://$IP:$PORT/_/#/$TOKEN ===" || true
