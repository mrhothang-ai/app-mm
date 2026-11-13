#!/bin/bash
# Kiem tra server truoc khi cai app Kitting (MM). Khong thay doi gi tren server.
# Tham so: $1 = cong (mac dinh 8097)
cd "$(dirname "$0")"
PORT=${1:-8097}
[ -f .env ] && P2=$(grep -E '^MM_PORT=' .env | cut -d= -f2) && [ -n "$P2" ] && PORT=$P2
FAIL=0
ok()   { echo "  [OK]   $*"; }
warn() { echo "  [CANH BAO] $*"; }
bad()  { echo "  [LOI]  $*"; FAIL=1; }
echo "=== KIEM TRA SERVER $(hostname) - $(date '+%d/%m/%Y %H:%M') ==="
if command -v docker >/dev/null 2>&1; then ok "Co docker: $(docker --version 2>/dev/null | cut -d, -f1)"; else bad "Chua cai docker"; fi
if docker ps >/dev/null 2>&1; then ok "User $(whoami) chay duoc lenh docker"; else bad "User $(whoami) khong chay duoc 'docker ps' (them vao nhom docker: sudo usermod -aG docker $(whoami))"; fi
if docker compose version >/dev/null 2>&1; then ok "Co docker compose: $(docker compose version --short 2>/dev/null)"; else bad "Thieu 'docker compose' (plugin v2)"; fi
PB=""
[ -f ./pocketbase ] && PB=./pocketbase
[ -z "$PB" ] && [ -f ../app_org/pocketbase ] && PB=../app_org/pocketbase
if [ -n "$PB" ]; then
  V=$("$PB" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  if [ "$V" = "0.40.4" ]; then ok "File chuong trinh pocketbase $V ($PB)"; else warn "pocketbase phien ban '$V' (app duoc kiem tren 0.40.4) - $PB"; fi
else bad "Khong thay file pocketbase (can ../app_org/pocketbase)"; fi
MINE=$(docker ps -a -q -f name='^pb_mm_app$' 2>/dev/null)
if [ -n "$MINE" ]; then
  ok "Da co container pb_mm_app ($(docker inspect -f '{{.State.Status}}' pb_mm_app 2>/dev/null)) - se cap nhat, giu nguyen du lieu"
else
  USED=$(docker ps --format '{{.Names}} {{.Ports}}' 2>/dev/null | grep -E "[:.]$PORT->" | awk '{print $1}')
  if [ -n "$USED" ]; then bad "Cong $PORT dang do container '$USED' dung - doi MM_PORT trong env.default";
  elif (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep -qE "[:.]$PORT\s"; then bad "Cong $PORT dang bi chuong trinh khac dung";
  else ok "Cong $PORT con trong"; fi
fi
FREE=$(df -Pm . | awk 'NR==2{print $4}')
if [ "${FREE:-0}" -ge 1024 ]; then ok "O dia con trong: ${FREE} MB"; else bad "O dia chi con ${FREE} MB (can >= 1024 MB)"; fi
if command -v curl >/dev/null 2>&1; then ok "Co curl (dung de tao tai khoan dau tien)"; else warn "Khong co curl - phai tao tai khoan admin app bang tay (HUONGDAN muc 3)"; fi
echo "  [INFO] Gio server: $(date '+%H:%M %Z')  - cac app dang chay:"
docker ps --format '         {{.Names}}  {{.Status}}  {{.Ports}}' 2>/dev/null
if [ "$FAIL" = 1 ]; then echo "=== KIEM TRA KHONG DAT - DUNG LAI, CHUA CAI GI ==="; exit 1; fi
echo "=== KIEM TRA DAT ==="
