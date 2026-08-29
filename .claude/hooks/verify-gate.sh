#!/usr/bin/env bash
# PreToolUse(Bash) ゲート: 検証を通していない `git commit` を止める。
#
# 変更ファイルの種類だけを見て、必要な verify を選んで走らせる。
#   *.ts / *.tsx / tsconfig / vite.config / package.json -> npm run verify
#   *.rs / Cargo.toml / Cargo.lock                       -> npm run verify:rust
# どちらにも当たらない変更（docs/ や .claude/ など）は素通しする。
#
# 落ちたら permissionDecision: deny を返してコミット自体を止める。
# 逃げ道は用意しない。逃げ道を用意した時点でゲートではなくなる。
#
# 判定部分（commit の検出とツリーの決定）は `verify-gate.test.sh` が固定している。
# ここを触ったらそちらも走らせること。

set -uo pipefail

# コマンド文字列に `git commit` があるかを見る。無ければ空を返す。
#
# 複合コマンドの中の commit も拾う。`-C <dir>` や `--git-dir=<dir>` のように
# 値を取るオプションも越えて commit に届くこと。値を許さないと
# `git -C <worktree> commit` がゲートを丸ごと素通しし、それは検証を飛ばす
# 最も自然な手口になる。git は空白区切りと `=` の両方を受けるので両方許す。
gate_matches_commit() {
  local git_opt='(--?(C|c|git-dir|work-tree|namespace|super-prefix)([[:space:]]+|=)[^[:space:]]+|-[^[:space:]]+)'
  printf '%s' "$1" | grep -Eq "(^|[;&|(]|[[:space:]])git([[:space:]]+$git_opt)*[[:space:]]+commit([[:space:]]|$)"
}

# コミットされるツリーの位置を決める。決められなければ空を返す。
#
# `-C <dir>` などでツリーを付け替えられていたら、その先を見る。ここを見落とすと
# 「別のワークツリーへコミットしつつ、検証は手元のツリーで済ませる」が通る。
# ワークツリーで作業しているとき CLAUDE_PROJECT_DIR は元のチェックアウトを
# 指したままなので、最後の手段にしか使わない。
gate_target_dir() {
  local command=$1 dir=""

  dir=$(printf '%s' "$command" | grep -Eo '(^|[[:space:]])-C([[:space:]]+|=)[^[:space:]]+' | tail -1 | sed -E 's/.*-C([[:space:]]+|=)//')
  if [ -z "$dir" ]; then
    dir=$(printf '%s' "$command" | grep -Eo -- '--work-tree([[:space:]]+|=)[^[:space:]]+' | tail -1 | sed -E 's/--work-tree([[:space:]]+|=)//')
  fi

  if [ -n "$dir" ]; then
    git -C "$dir" rev-parse --show-toplevel 2>/dev/null
    return
  fi

  git rev-parse --show-toplevel 2>/dev/null || printf '%s' "${CLAUDE_PROJECT_DIR:-}"
}

# 読み込まれただけのときは判定関数を定義して終わる（テストから使う）。
[ "${GATE_LIB_ONLY:-0}" = "1" ] && return 0

payload=$(cat)
command=$(printf '%s' "$payload" | jq -r '.tool_input.command // ""')

gate_matches_commit "$command" || exit 0

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

project_dir=$(gate_target_dir "$command")
if [ -z "$project_dir" ]; then
  deny "検証ゲート: どのツリーへコミットするのか決められなかった。
git のディレクトリ指定を外し、対象のワークツリーの中から実行すること。"
fi
cd "$project_dir" || exit 0

# ステージ済みと作業ツリーの両方を見る（`git commit -a` を取りこぼさないため）。
# リネーム行 "R  old -> new" は新しい方だけを見れば足りる。
needs_ts=0
needs_rust=0
while IFS= read -r line; do
  path=${line:3}
  path=${path##* -> }
  case "$path" in
    *.ts|*.tsx|tsconfig*.json|vite.config.ts|package.json|package-lock.json) needs_ts=1 ;;
  esac
  case "$path" in
    *.rs|*Cargo.toml|*Cargo.lock) needs_rust=1 ;;
  esac
done < <(git status --porcelain --untracked-files=no)

if [ "$needs_ts" -eq 0 ] && [ "$needs_rust" -eq 0 ]; then
  exit 0
fi

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
