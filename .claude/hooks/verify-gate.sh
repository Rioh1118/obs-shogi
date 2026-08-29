#!/usr/bin/env bash
# PreToolUse(Bash) ゲート: 検証を通していない `git commit` を止める。
#
# 変更ファイルの種類だけを見て、必要な verify を選んで走らせる。
#   *.ts / *.tsx / tsconfig / vite.config / package.json -> npm run verify
#   *.rs / Cargo.toml / Cargo.lock                       -> npm run verify:rust
# どちらにも当たらない変更（docs/ など）は素通しする。ただし `.claude/hooks/*.sh`
# は、このゲート自身を決めているので例外（ケース表を走らせる）。
#
# 落ちたら permissionDecision: deny を返してコミット自体を止める。
# 逃げ道は用意しない。逃げ道を用意した時点でゲートではなくなる。
#
# 判定部分（commit の検出とツリーの決定）は `verify-gate.test.sh` が固定している。
# ここを触ったらそちらも走らせること。

set -uo pipefail

# コマンド文字列を1行に畳む。
#
# 判定は grep（行単位）なので、`git \` + 改行 + `commit` のように行を跨ぐ綴りは
# パターンが成立せず、ゲートごと素通しする。
gate_flatten() {
  printf '%s' "$1" | sed -E 's/\\$//' | tr '\n' ' '
}

# 引用の中身を空にする。
#
# コミットメッセージに `git commit` と書いただけで「呼び出しが2つある」と数えると、
# ゲートの説明を書いたコミットほど止まる。ただし `$(` とバッククォートを含む引用は
# 中で本当にコマンドが走るので潰さない。
gate_strip_quotes() {
  # 空白を含む引用だけを潰す。'''git''' のように語ひとつを引用しただけの綴りは
  # 呼び出しの一部なので残す。
  gate_flatten "$1" | sed -E "s/'[^'\`\$]*[[:space:]][^'\`\$]*'/''/g; s/\"[^\"\`\$]*[[:space:]][^\"\`\$]*\"/\"\"/g"
}

# コミットを作る git 呼び出しに当たる部分を切り出す。無ければ空を返す。
#
# 複合コマンドの中の呼び出しも拾う。オプションの値は引用符とエスケープを含めて
# 飲む。`git -c 'user.name=A B' commit` のように値に空白が入る綴りを切り出せないと、
# 最後の網（gate_mentions_commit）に落ちて deny になる。素通しはしないが、
# 打てないコマンドが増えるので飲めるようにしておく。
#
# `git` の直前には、パス修飾や引用（`/usr/bin/git` / `'git'` / `\git`）が付きうる。
GATE_OPT_VALUE="('[^']*'|\"[^\"]*\"|(\\\\.|[^[:space:]])+)"
GATE_GIT_OPT="(--?(C|c|git-dir|work-tree|namespace|super-prefix)([[:space:]]+|=)$GATE_OPT_VALUE|-[^[:space:]]+)"
GATE_GIT_WORD="['\"\\\\]*[^[:space:];&|()]*git['\"]?"

# コミットを作る git サブコマンド。commit だけを見ていると、cherry-pick や
# rebase で出来たツリーが一度も検証されないままコミットになる。
GATE_COMMIT_VERB='(commit|revert|cherry-pick|merge|rebase|am)'

gate_commit_call() {
  gate_strip_quotes "$1" \
    | grep -Eo "(^|[;&|(]|[[:space:]])$GATE_GIT_WORD([[:space:]]+$GATE_GIT_OPT)*[[:space:]]+$GATE_COMMIT_VERB([[:space:]]|$)" \
    | tail -1
}

gate_matches_commit() {
  [ -n "$(gate_commit_call "$1")" ]
}

gate_commit_count() {
  gate_strip_quotes "$1" \
    | grep -Eo "(^|[;&|(]|[[:space:]])$GATE_GIT_WORD([[:space:]]+$GATE_GIT_OPT)*[[:space:]]+$GATE_COMMIT_VERB([[:space:]]|$)" \
    | grep -c .
}

# `git` とコミットを作るサブコマンドの両方を含むのに、呼び出しとして切り出せなかったもの。
#
# 綴りを言い当てられなかったという理由で止めるための最後の網。ここを素通しに
# すると、判別できない綴りが「検証もされず deny もされない」形で通る。
gate_mentions_commit() {
  local flat
  flat=$(gate_flatten "$1")
  printf '%s' "$flat" | grep -Eq '(^|[^[:alnum:]_.-])git([^[:alnum:]_-]|$)' \
    && printf '%s' "$flat" | grep -Eq "(^|[^[:alnum:]_-])$GATE_COMMIT_VERB([^[:alnum:]_-]|\$)"
}

# コミットされるツリーの位置を決める。決められなければ空を返す。
#
# **コマンド文字列からディレクトリを読み取ることはしない。**
# コミット先を変える綴りは `git -C` / `cd X &&` / `(cd X && …)` / `pushd` /
# `env -C` / `env --chdir=` / `GIT_DIR=` と際限が無く、シェルの文字列から
# 言い当てるのは原理的に閉じない。だから言い当てない。
#
# 通すのは、宛先が自明な形だけ。すなわち「起点の作業ディレクトリで、ディレクトリ
# 指定の無い `git commit` が1つだけ走り、その手前には別の git 呼び出ししか無い」。
# 手前を許可リストで見るのは、拒否リストが必ず次の綴りに置いていかれるため。
# 起点は呼び出し元から渡す（Bash の作業ディレクトリは呼び出しを跨いで持続するので、
# hook 自身の CWD はコマンドが実際に走る場所と一致しないことがある）。
gate_target_dir() {
  local command=$1 base=${2:-$PWD} call flat prefix

  call=$(gate_commit_call "$command")
  [ -n "$call" ] || return 0

  # コミットを作る呼び出しが2つ以上あるなら、別々のツリーへ入りうる。
  [ "$(gate_commit_count "$command")" -eq 1 ] || return 0

  # git 自身のディレクトリ指定。
  case "$call" in
    *-C*|*--git-dir*|*--work-tree*|*--namespace*) return 0 ;;
  esac

  # 手前に置いてよいのは、ディレクトリ指定の無い git 呼び出しだけ。
  flat=$(gate_strip_quotes "$command")
  prefix=${flat%"$call"*}
  # 空の prefix も1行として渡す。printf '%s' だと行が無く、grep が必ず外れる。
  printf '%s\n' "$prefix" \
    | grep -Eq '^[[:space:]]*(git[[:space:]]+[^;&|()<>]*(&&|;)[[:space:]]*)*$' \
    || return 0

  case "$prefix" in
    *-C*|*--git-dir*|*--work-tree*) return 0 ;;
  esac

  git -C "$base" rev-parse --show-toplevel 2>/dev/null
}

# 読み込まれただけのときは判定関数を定義して終わる（テストから使う）。
[ "${GATE_LIB_ONLY:-0}" = "1" ] && return 0

payload=$(cat)
command=$(printf '%s' "$payload" | jq -r '.tool_input.command // ""')
cwd=$(printf '%s' "$payload" | jq -r '.cwd // ""')

if ! gate_matches_commit "$command"; then
  # 呼び出しとして切り出せないのに git と commit が並んでいるなら、綴りを
  # 言い当てられなかったということ。素通しさせない。
  gate_mentions_commit "$command" || exit 0
  gate_unknown_spelling=1
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

if [ "${gate_unknown_spelling:-0}" = "1" ]; then
  deny "検証ゲート: git commit の呼び出しを判別できなかった。

ディレクトリ指定の無い \`git commit\` 単体として、1行で実行すること。"
fi

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
#
# リネーム行 "R  old -> new" は両側を見る。新しい方だけだと、`.rs` を別の拡張子へ
# 改名するコミットが Rust の変更として数えられない。
needs_ts=0
needs_rust=0
needs_gate=0
while IFS= read -r line; do
  paths=${line:3}
  for path in "${paths%% -> *}" "${paths##* -> }"; do
    case "$path" in
      *.ts|*.tsx|tsconfig*.json|vite.config.ts|package.json|package-lock.json) needs_ts=1 ;;
    esac
    case "$path" in
      *.rs|*Cargo.toml|*Cargo.lock) needs_rust=1 ;;
    esac
    case "$path" in
      .claude/hooks/*.sh) needs_gate=1 ;;
    esac
  done
done < <(git status --porcelain --untracked-files=no)

if [ "$needs_ts" -eq 0 ] && [ "$needs_rust" -eq 0 ] && [ "$needs_gate" -eq 0 ]; then
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

[ "$needs_gate" -eq 1 ] && run_gate "verify-gate.test.sh" bash .claude/hooks/verify-gate.test.sh
[ "$needs_ts" -eq 1 ] && run_gate "npm run verify" npm run verify
[ "$needs_rust" -eq 1 ] && run_gate "npm run verify:rust" npm run verify:rust

exit 0
