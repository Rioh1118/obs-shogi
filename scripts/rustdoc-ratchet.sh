#!/usr/bin/env bash
# rustdoc の警告を、増える方向にだけ落とす。
#
# **`-D warnings` にはしない。** 既存の警告を先に片付ける必要があり、
# そのぶん導入が先送りになる。数だけ見れば今日から張れて、
# 新しく壊れたリンクはその場で止まる。
#
# 拾うのは「別の場所に本文がある」と読ませる導線が切れる形。
# 非公開項目を指す・解決しないリンク・閉じないタグ。どれも `cargo fmt` も
# `clippy` も見ないので、これが唯一の門番。
#
# **減らしたら BASELINE を下げること。** 下げないと、次に増えたぶんが隠れる。
set -euo pipefail

# `cargo doc` が最後に出す `generated N warnings` の集計行は数えない。
# 数えると画面の N と基準がずれて、直す人がまず数の食い違いを疑う。
BASELINE=11

cd "$(dirname "$0")/.."
count=$(cargo doc --manifest-path src-tauri/Cargo.toml --no-deps -p app 2>&1 |
  grep '^warning' | grep -vc 'generated' || true)

if [ "$count" -gt "$BASELINE" ]; then
  echo "rustdoc の警告が増えた: ${count}（基準 ${BASELINE}）" >&2
  echo "" >&2
  cargo doc --manifest-path src-tauri/Cargo.toml --no-deps -p app 2>&1 |
    grep -A 3 '^warning' >&2
  exit 1
fi

if [ "$count" -lt "$BASELINE" ]; then
  echo "rustdoc の警告が ${count} 件に減った。scripts/rustdoc-ratchet.sh の BASELINE を下げること" >&2
  exit 1
fi

echo "rustdoc warnings: $count (baseline $BASELINE)"
