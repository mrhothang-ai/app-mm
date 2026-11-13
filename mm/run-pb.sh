#!/bin/bash
D=${1:-/tmp/pbrun}
mkdir -p $D
cd "$(dirname "$0")/pkg/mm-app"
PB=${PB_BIN:-pocketbase}   # đường dẫn file chương trình PocketBase 0.40.4
MM_API_KEY=test-key-1234567890abcd nohup "$PB" serve --http=127.0.0.1:8197 --dir=$D/pb_data --hooksDir=${HOOKS:-./pb_hooks} --migrationsDir=./pb_migrations --publicDir=./pb_public > $D/pb.log 2>&1 &
