#!/usr/bin/env bash
# PreToolUse(Bash) ゲート: 検証を通していない `git commit` を止める。
#
# 選ぶ基準は**ファイルの種類ではなく、検査が何を見ているか**。
#
#   npm run verify:rust  ... cargo が見るもの（*.rs / Cargo.*）
#   npm run verify       ... tsc と lint と vitest が見るもの。
#                            **`src/__tests__` の検査のいくつかは
#                            `src-tauri/src` と `docs/` を直に読む。**
#                            どれがそうかを列挙しない（数え上げると必ず1つ漏れる）。
#                            一覧が要るなら CONTRIBUTING.md の表を見ること
#
# **種類で二分しない。** 二分すると、`.rs` だけのコミットで Rust のコメント規約が
# 走らず、`docs/` だけのコミットで表の識別子とパスが誰にも見られない。
# 落ちるのは次に `.ts` を1文字触った人で、その人は自分が書いていない赤を踏む。
#
# どの検査にも当たらない変更（`.claude/` など）は素通しする。
#
# 落ちたら permissionDecision: deny を返してコミット自体を止める。
# 逃げ道は用意しない。逃げ道を用意した時点でゲートではなくなる。

set -uo pipefail

payload=$(cat)
command=$(printf '%s' "$payload" | jq -r '.tool_input.command // ""')

# `git commit` を含まないコマンドは素通し。複合コマンドの中の commit も拾う。
if ! printf '%s' "$command" | grep -Eq '(^|[;&|(]|[[:space:]])git([[:space:]]+-[^[:space:]]+)*[[:space:]]+commit([[:space:]]|$)'; then
  exit 0
fi

project_dir="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -n "$project_dir" ] || exit 0
cd "$project_dir" || exit 0

# ステージ済みと作業ツリーの両方を見る（`git commit -a` を取りこぼさないため）。
# リネーム行 "R  old -> new" は新しい方だけを見れば足りる。
needs_ts=0
needs_rust=0
while IFS= read -r line; do
  path=${line:3}
  path=${path##* -> }
  case "$path" in
    *.rs|*Cargo.toml|*Cargo.lock) needs_rust=1 ;;
  esac
  # `npm run verify` の対象。**`.rs` と `docs/` もここに入る。**
  # vitest のラチェットが `src-tauri/**` と `docs/**` を歩いているので、
  # そこを触ったコミットで走らせないと検査が素通りする
  case "$path" in
    *.ts|*.tsx|tsconfig*.json|vite.config.ts|package.json|package-lock.json) needs_ts=1 ;;
    *.rs|*Cargo.toml|*Cargo.lock) needs_ts=1 ;;
    docs/*) needs_ts=1 ;;
    *.scss|CONTRIBUTING.md) needs_ts=1 ;;
  esac
done < <(git status --porcelain --untracked-files=no)

if [ "$needs_ts" -eq 0 ] && [ "$needs_rust" -eq 0 ]; then
  exit 0
fi

deny() {
  jq -n --arg reason "$1" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
  exit 0
}

run_gate() {
  local label=$1 out
  if ! out=$("${@:2}" 2>&1); then
    deny "検証ゲート失敗: ${label}

$(printf '%s' "$out" | tail -40)

コミットは実行していない。上を直してから再度コミットすること。
検証を飛ばして「完了」と報告しないこと。"
  fi
}

[ "$needs_ts" -eq 1 ] && run_gate "npm run verify" npm run verify
[ "$needs_rust" -eq 1 ] && run_gate "npm run verify:rust" npm run verify:rust

exit 0
