#!/bin/bash
# dựng instance thử mới tinh: migration + tài khoản + dữ liệu + kịch bản demo
for p in $(pgrep -x pocketbase); do kill $p; done; sleep 1
rm -rf /tmp/pbrun; node build.mjs >/dev/null && node build-test.mjs >/dev/null
HOOKS=$(node -e "console.log(require('os').tmpdir())")/pbhooks ./run-pb.sh; sleep 3
"${PB_BIN:-pocketbase}" superuser upsert admin@test.local Admin12345678 --dir=/tmp/pbrun/pb_data >/dev/null
node --no-warnings test-api.mjs
curl -s -X POST localhost:8197/api/mmtest/seed; echo
