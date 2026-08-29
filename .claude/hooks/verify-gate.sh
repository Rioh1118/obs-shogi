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
# 複合コマンドの中の commit も拾う。`-C <dir>` や `--git-dir=<dir>` のように
# 値を取るオプションも越えて commit に届くこと。値を許さないと
# `git -C <worktree> commit` がゲートを丸ごと素通しし、それは検証を飛ばす
# 最も自然な手口になる。git は空白区切りと `=` の両方を受けるので両方許す。
#
# 切り出した区間を gate_target_dir が読む。コマンド全体から `-C` を探すと、
# `tar -C dir && git commit` のような git 以外の `-C` を拾ってしまう。
GATE_GIT_OPT='(--?(C|c|git-dir|work-tree|namespace|super-prefix)([[:space:]]+|=)[^[:space:]]+|-[^[:space:]]+)'

gate_commit_call() {
  printf '%s' "$1" \
    | grep -Eo "(^|[;&|(]|[[:space:]])git([[:space:]]+$GATE_GIT_OPT)*[[:space:]]+commit([[:space:]]|$)" \
    | tail -1
}

gate_matches_commit() {
  [ -n "$(gate_commit_call "$1")" ]
}

# コミットされるツリーの位置を決める。決められなければ空を返す。
#
# 見るのは3つ。(1) 呼び出しより前に効いている `cd` / `pushd`、(2) その `git`
# 呼び出しに属する `-C` / `--work-tree`、(3) 起点となる作業ディレクトリ。
# ここを見落とすと「別のワークツリーへコミットしつつ、検証は手元のツリーで
# 済ませる」が通る。
#
# 起点は呼び出し元から渡す。Bash の作業ディレクトリは呼び出しを跨いで持続する
# ので、hook 自身の CWD ではコマンドが実際に走る場所と一致しない。
#
# **解釈できない綴りは空を返す。** 素通しになる綴りを1つずつ足していく形だと、
# 綴りを変えるだけで検証を飛ばせる状態が残り続ける。判別できないなら止める。
# 決められないものは次のとおり。
#   - 作業ディレクトリを別の仕組みで動かすもの（env -C / eval / sh -c / bash -c）
#   - 展開しないと分からないもの（$VAR / `...` / $(...) / ~ を含むパス）
#   - `--git-dir` だけの指定（`--work-tree` が無ければ作業ツリーは cwd になる）
#   - 1つのコマンドに commit が2つ以上（別々のツリーへ入りうる）
gate_target_dir() {
  local command=$1 base=${2:-$PWD} call dir="" segment target

  call=$(gate_commit_call "$command")
  [ -n "$call" ] || return 0

  # commit が2つ以上あるなら、どのツリーの話か決められない。
  [ "$(gate_commit_count "$command")" -eq 1 ] || return 0

  # 呼び出しより前のセグメントに現れる cd / pushd を順に適用する。
  # `%` は最後の一致の直前まで。`%%` にすると最初の commit までしか見ない。
  local prefix=${command%"$call"*}

  case $prefix in
    *env\ -C*|*eval\ *|*sh\ -c*|*bash\ -c*|*'$('*|*'`'*) return 0 ;;
  esac

  local IFS='
'
  for segment in $(printf '%s' "$prefix" | sed -E 's/(\&\&|\|\||;|\|)/\n/g'); do
    # サブシェルや複合コマンドの開き括弧を落としてから見る。
    segment=${segment#"${segment%%[![:space:]]*}"}
    segment=${segment#[({!]}
    segment=${segment#"${segment%%[![:space:]]*}"}

    case "$segment" in
      cd\ *|pushd\ *)
        target=${segment#* }
        target=${target%%[[:space:]]*}
        target=$(gate_unquote "$target") || return 0
        case "$target" in
          /*) base=$target ;;
          *) base="$base/$target" ;;
        esac
        ;;
    esac
  done

  case "$call" in
    *--git-dir*)
      case "$call" in
        *--work-tree*) ;;
        *) return 0 ;;
      esac
      ;;
  esac

  dir=$(printf '%s' "$call" | grep -Eo -- '--work-tree([[:space:]]+|=)[^[:space:]]+' | tail -1 | sed -E 's/--work-tree([[:space:]]+|=)//')
  if [ -z "$dir" ]; then
    dir=$(printf '%s' "$call" | grep -Eo '(^|[[:space:]])-C([[:space:]]+|=)?[^[:space:]]+' | tail -1 | sed -E 's/.*-C([[:space:]]+|=)?//')
  fi

  if [ -n "$dir" ]; then
    dir=$(gate_unquote "$dir") || return 0
    case "$dir" in
      /*) base=$dir ;;
      *) base="$base/$dir" ;;
    esac
  fi

  git -C "$base" rev-parse --show-toplevel 2>/dev/null
}

# 引用符を剥がす。展開が要る綴りなら 1 を返して呼び出し側を deny へ落とす。
gate_unquote() {
  local value=$1
  value=${value#[\"\']}
  value=${value%[\"\']}
  case "$value" in
    *'$'*|*'`'*|'~'*) return 1 ;;
  esac
  printf '%s' "$value"
}

gate_commit_count() {
  printf '%s' "$1" \
    | grep -Eo "(^|[;&|(]|[[:space:]])git([[:space:]]+$GATE_GIT_OPT)*[[:space:]]+commit([[:space:]]|$)" \
    | grep -c .
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
別の呼び出しで対象のワークツリーへ cd し、変数や ~ を含まない形で実行すること。
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
