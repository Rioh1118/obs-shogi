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

# rustdoc の警告数。**これは `(lib doc) generated N warnings` の N**
# （`cargo doc --no-deps -p app --document-private-items`）。
# **減らしたらここを下げること。**
#
# **非公開の項目も見る。** 公開面だけを見ると、モジュールを割ったときに
# 中で切れたリンクが1つも映らない。実際に定跡を割り直したとき、
# 6本の intra-doc リンクが解決しなくなったのにここは緑のままだった。
BASELINE=28

cd "$(dirname "$0")/.."
# **rustdoc の集計行から読む。** `^warning` を数えると rustc の警告
# （unused import など）まで混ざり、「rustdoc の警告が増えた」と言いながら
# 直す人をリンク切れ探しへ送り出す。`(lib) generated` は rustc 側なので取らない。
# 警告が0件だと集計行そのものが出ないので、そのときは0
out=$(cargo doc --manifest-path src-tauri/Cargo.toml --no-deps -p app \
  --document-private-items 2>&1 || true)
count=$(printf '%s\n' "$out" |
  sed -n 's/^warning: .*(lib doc) generated \([0-9]*\) warning.*/\1/p' | tail -1)
count=${count:-0}

if [ "$count" -gt "$BASELINE" ]; then
  echo "rustdoc の警告が増えた: ${count}（基準 ${BASELINE}）" >&2
  echo "" >&2
  printf '%s\n' "$out" | grep -A 3 '^warning' >&2
  exit 1
fi

if [ "$count" -lt "$BASELINE" ]; then
  echo "rustdoc の警告が ${count} 件に減った。scripts/rustdoc-ratchet.sh の BASELINE を下げること" >&2
  exit 1
fi

echo "rustdoc warnings: $count (baseline $BASELINE)"
