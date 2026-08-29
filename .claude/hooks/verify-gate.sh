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

# `git ... commit` の呼び出しに当たる部分を切り出す。無ければ空を返す。
#
# 複合コマンドの中の commit も拾う。オプションの値は引用符とエスケープを含めて
# 飲む。`git -c 'user.name=A B' commit` のように値に空白が入るだけで commit まで
# 届かなくなると、ゲートは deny も検証もせずに素通しする。
GATE_OPT_VALUE="('[^']*'|\"[^\"]*\"|(\\\\.|[^[:space:]])+)"
GATE_GIT_OPT="(--?(C|c|git-dir|work-tree|namespace|super-prefix)([[:space:]]+|=)$GATE_OPT_VALUE|-[^[:space:]]+)"

gate_commit_call() {
  printf '%s' "$1" \
    | grep -Eo "(^|[;&|(]|[[:space:]])git([[:space:]]+$GATE_GIT_OPT)*[[:space:]]+commit([[:space:]]|$)" \
    | tail -1
}

gate_matches_commit() {
  [ -n "$(gate_commit_call "$1")" ]
}

gate_commit_count() {
  printf '%s' "$1" \
    | grep -Eo "(^|[;&|(]|[[:space:]])git([[:space:]]+$GATE_GIT_OPT)*[[:space:]]+commit([[:space:]]|$)" \
    | grep -c .
}

# コミットされるツリーの位置を決める。決められなければ空を返す。
#
# **コマンド文字列からディレクトリを読み取ることはしない。** 4ラウンド続けて、
# 綴りを変えるだけで別のツリーへコミットしつつ手元のツリーで検証を済ませる穴が
# 出た（`git -C` / `cd X &&` / `(cd X && …)` / `pushd` / `env -C` / `env --chdir=`）。
# シェルの文字列からコミット先を言い当てるのは原理的に閉じないので、言い当てない。
#
# 宛先が自明な形だけを通す。すなわち「起点の作業ディレクトリで、ディレクトリ指定の
# 無い `git commit` が1つだけ走る」。それ以外は空を返して deny 側へ落とす。
# 起点は呼び出し元から渡す（Bash の作業ディレクトリは呼び出しを跨いで持続するので、
# hook 自身の CWD はコマンドが実際に走る場所と一致しないことがある）。
gate_target_dir() {
  local command=$1 base=${2:-$PWD} call

  call=$(gate_commit_call "$command")
  [ -n "$call" ] || return 0

  # commit が2つ以上あるなら、別々のツリーへ入りうる。
  [ "$(gate_commit_count "$command")" -eq 1 ] || return 0

  # git 自身のディレクトリ指定。
  case "$call" in
    *-C*|*--git-dir*|*--work-tree*|*--namespace*) return 0 ;;
  esac

  # 同じコマンドの中で作業ディレクトリを動かすもの、および展開しないと
  # 分からないもの。`cd` を含む綴り（`(cd …` / `builtin cd` / `pushd`）は
  # まとめてここで落ちる。
  local prefix=${command%"$call"*}
  case "$prefix" in
    *cd*|*pushd*|*popd*|*env*|*eval*|*-c\ *|*'$('*|*'`'*) return 0 ;;
  esac

  git -C "$base" rev-parse --show-toplevel 2>/dev/null
}

# 読み込まれただけのときは判定関数を定義して終わる（テストから使う）。
[ "${GATE_LIB_ONLY:-0}" = "1" ] && return 0

payload=$(cat)
command=$(printf '%s' "$payload" | jq -r '.tool_input.command // ""')
cwd=$(printf '%s' "$payload" | jq -r '.cwd // ""')

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

project_dir=$(gate_target_dir "$command" "${cwd:-$PWD}")
if [ -z "$project_dir" ]; then
  deny "検証ゲート: どのツリーへコミットするのか決められなかった。

別の呼び出しで対象のワークツリーへ移動してから、
ディレクトリ指定の無い \`git commit\` 単体として実行すること。
同じコマンドの中で cd / pushd / env / サブシェルを使わないこと。
1つのコマンドに commit を2つ以上並べないこと。"
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
