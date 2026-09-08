#!/usr/bin/env bash
# 到達しない export・型・ファイルを、増える方向にだけ落とす。
#
# **0 にはできない。** `src/entities/game-session/**` の4ファイルは、未マージの
# エンジン作業が使う Tauri コマンドの薄皮で、`src/main.tsx` からは到達しない。
# 消すと合流時に書き直しになる。数だけ見れば今日から張れて、
# 新しく死んだ export はその場で止まる。
#
# `oxlint` の `no-unused-vars` は **export された宣言を見ない**ので、
# 到達しない公開面はこれが唯一の門番。
#
# **減らしたら BASELINE を下げること。** 下げないと、次に増えたぶんが隠れる。
set -euo pipefail

# `npm run deadcode`（= knip --include exports,types,files）が出す
# `Unused ...（N）` の合計。内訳は未使用ファイル・未使用 export・未使用の型。
# **減らしたらここを下げること。**
BASELINE=150

cd "$(dirname "$0")/.."

# knip は指摘があると終了コード1を返すので `|| true` で受ける。
# 集計は見出し行（`Unused exports (58)` など）の括弧内を足す。個々の行を数えると、
# 綴りの長い項目が折り返されたときに二重に数える。
output=$(npx knip --include exports,types,files --no-progress 2>&1 || true)
count=$(printf '%s\n' "$output" |
  grep -oE '^Unused [a-z ]+\([0-9]+\)' |
  grep -oE '[0-9]+' |
  awk '{ n += $1 } END { print n + 0 }')

if [ "$count" -gt "$BASELINE" ]; then
  echo "到達しない export/型/ファイルが増えた: ${count}（基準 ${BASELINE}）" >&2
  echo "" >&2
  printf '%s\n' "$output" >&2
  exit 1
fi

if [ "$count" -lt "$BASELINE" ]; then
  echo "到達しない export/型/ファイルが ${count} 件に減った。scripts/knip-ratchet.sh の BASELINE を下げること" >&2
  exit 1
fi

echo "knip unused: $count (baseline $BASELINE)"
