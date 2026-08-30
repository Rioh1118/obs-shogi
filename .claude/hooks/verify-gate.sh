#!/usr/bin/env bash
# PreToolUse(Bash) ゲート: 検証を通していない `git commit` を止める。
#
# 変更ファイルの種類だけを見て、必要な verify を選んで走らせる。
# どの種類がどれを呼ぶかは `gate_kinds_for_path` が唯一の出典（ここに写さない。
# 2箇所に書くと必ず片方が腐る）。当たらない変更（docs/ など）は素通しする。
#
# 落ちたら permissionDecision: deny を返してコミット自体を止める。
# 逃げ道は用意しない。逃げ道を用意した時点でゲートではなくなる。
#
# 判定に関わる関数は `verify-gate.test.sh` が表で固定している。どの関数に表が
# あるかは、そちらの `expect_*` の定義を見ること。ここを触ったら走らせること
# （`.claude/hooks/*.sh` を変更したコミットでは、このゲート自身が走らせる）。

set -uo pipefail

# コマンド文字列を1行に畳む。
#
# 判定は grep（行単位）なので、`git \` + 改行 + `commit` のように行を跨ぐ綴りは
# 畳まないとパターンが成立せず、最後の網に落ちて deny になる。素通しはしないが、
# 複数行で打っただけのコミットが止まる。
gate_flatten() {
  printf '%s' "$1" | sed -E 's/\\$//' | tr '\n' ' '
}

# 引用の中身を空にする。
#
# コミットメッセージにゲートの説明を書いただけで「呼び出しが2つある」と数えると、
# ゲートの話を書いたコミットほど止まる。
#
# 潰すのは、引用符がトークンの先頭に来ていて、中に空白を含むものだけ。
#   - トークンの先頭に限るのは、"don't" のような語中のアポストロフィを引用の
#     開始と読むと、そこから次の ' までが丸ごと消えて、間にある cd や2つ目の
#     呼び出しまで見えなくなるため
#   - 空白を含むものに限るのは、'git' のように語ひとつを引用しただけの綴りが
#     呼び出しの一部だから
#
# 二重引用符の中は変数展開もコマンド置換も走るので、$ と backtick を含むものは
# 潰さない。単一引用符の中では何も走らないので、その条件は掛けない。
gate_strip_quotes() {
  gate_flatten "$1" \
    | sed -E 's/(^|[[:space:]=])"[^"`$]*[[:space:]][^"`$]*"([[:space:];\&|)]|$)/\1""\2/g' \
    | sed -E "s/(^|[[:space:]=])'[^']*[[:space:]][^']*'([[:space:];\&|)]|\$)/\1''\2/g"
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

# コミットを作りうる git サブコマンド。
#
# `commit` は、手元の index と作業ツリーがそのままコミットされるので、下の
# 検証（`npm run verify` / `verify:rust`）が掛かる。それ以外
# （`revert` / `cherry-pick` / `merge` / `rebase` / `am` / `pull`）が作るツリーは
# コマンドの前には存在しないので検証できない。**宛先の判定（`-C` 付き /
# 呼び出しが複数）へ載せて deny の対象にするために語彙へ入れている。**
GATE_COMMIT_VERB_BASE='commit|revert|cherry-pick|merge|rebase|am|pull'

# alias で付けられた別名。`git ci` のように、綴りは利用者の設定で無限に増える。
#
# 語彙を人が書き足す形では次の alias に必ず置いていかれるので、git 自身に
# 引かせる。展開先にコミット動詞を「含む」もので拾うのは、`!f() { git commit … }`
# のような shell alias も取るため（過検出の側に倒す）。
#
# 展開先が別の alias（`acp = !… git ci …`）のこともあるので、増えなくなるまで
# 繰り返す。1周で止めると、合成した alias がそのまま素通しになる。
# テストから固定できるように `GATE_EXTRA_VERBS` で差し込めるようにしてある
# （設定されていれば空でもそれを使う。空は「alias 無し」の意味）。
gate_alias_verbs() {
  if [ -n "${GATE_EXTRA_VERBS+set}" ]; then
    printf '%s' "$GATE_EXTRA_VERBS"
    return 0
  fi

  local config known="$GATE_COMMIT_VERB_BASE" found="" added=1

  # -z で読む。`git config --get-regexp` は値に含まれる改行をそのまま出すので、
  # 素で読むと2行目以降が `alias.` で始まらず、名前を切り出せない。
  config=$(git config -z --get-regexp '^alias\.[^.]+$' 2>/dev/null \
    | tr '\n' ' ' | tr '\0' '\n') || return 0

  while [ "$added" -eq 1 ]; do
    added=0
    local names
    names=$(printf '%s\n' "$config" \
      | grep -E "(^|[^[:alnum:]_-])($known)([^[:alnum:]_-]|$)" \
      | sed -E 's/^alias\.([A-Za-z0-9_-]+).*/\1/' \
      | grep -E '^[A-Za-z0-9_-]+$')

    local name
    for name in $names; do
      case "|$found|" in
        *"|$name|"*) ;;
        *)
          found="${found:+$found|}$name"
          known="$known|$name"
          added=1
          ;;
      esac
    done
  done

  printf '%s' "$found"
}

# 判定に使う語彙。呼び出しは全てコマンド置換の中なので、ここで変数へ覚えても
# サブシェルの終わりで消える。素直に毎回組み立てる（`git config` 1回ぶん）。
gate_commit_verb() {
  local aliases
  aliases=$(gate_alias_verbs)
  printf '%s' "($GATE_COMMIT_VERB_BASE${aliases:+|$aliases})"
}

gate_commit_call() {
  gate_strip_quotes "$1" \
    | grep -Eo "(^|[;&|(]|[[:space:]])$GATE_GIT_WORD([[:space:]]+$GATE_GIT_OPT)*[[:space:]]+$(gate_commit_verb)([[:space:]]|$)" \
    | tail -1
}

gate_matches_commit() {
  [ -n "$(gate_commit_call "$1")" ]
}

gate_commit_count() {
  gate_strip_quotes "$1" \
    | grep -Eo "(^|[;&|(]|[[:space:]])$GATE_GIT_WORD([[:space:]]+$GATE_GIT_OPT)*[[:space:]]+$(gate_commit_verb)([[:space:]]|$)" \
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
    && printf '%s' "$flat" | grep -Eq "(^|[^[:alnum:]_-])$(gate_commit_verb)([^[:alnum:]_-]|\$)"
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

# パスから、必要な検証の種類を空白区切りで返す。
#
# `.scss` を ts 側に入れるのは、`npm run test` が `src/` の全 `.scss` を走査して
# 直値の件数を厳密一致で見ているため（ADR-0003 のラチェット）。`.scss` だけの
# コミットはここが唯一の検査になる。
#
# `tauri.conf.json` と `capabilities/*.json` を rust 側に入れるのは、`build.rs` と
# `generate_context!` がコンパイル時に読むため。壊すと clippy が落ちるので、
# そのファイルだけのコミットでも検証が要る。
# `rust-toolchain.toml` は、替えると clippy の lint 集合ごと変わって既存のコードが
# 落ちうるので同じ扱いにする。
#
# `.claude/hooks/*.sh` は、このゲート自身を決めているので例外として拾う。
gate_kinds_for_path() {
  local path=$1 kinds=""

  case "$path" in
    *.ts|*.tsx|*.scss|tsconfig*.json|vite.config.ts|package.json|package-lock.json) kinds="ts" ;;
  esac
  case "$path" in
    *.rs|*Cargo.toml|*Cargo.lock|src-tauri/tauri.conf.json|src-tauri/capabilities/*.json|rust-toolchain.toml)
      kinds="$kinds rust" ;;
  esac
  case "$path" in
    .claude/hooks/*.sh) kinds="$kinds gate" ;;
  esac

  printf '%s' "${kinds# }"
}

# 積んだ操作を畳む呼び出し。コミットを1つも作らないので、検証の対象にしない。
#
# 拾うのは `rebase` / `merge` / `cherry-pick` / `am` / `revert` の
# `--abort` / `--quit` / `--skip` / `--edit-todo`。
#
# これらを使うのは競合を抱えたツリーだけで、そこでは `package.json` に競合
# マーカが入っていて `npm run verify` が必ず落ちる。検証を要求すると、**競合を
# 畳む手段そのものが取り上げられて行き止まりになる。** 案内文も「再度コミット
# すること」になり、コミットしようとしていない利用者に従える操作が1つも無い。
#
# `--continue` は入れない。あれはコミットを作る。
#
# 1つの git 呼び出しだけに限るので、免除は広がらない。
# `git rebase --abort && git commit -m x` はここに当たらず、下の宛先の判定で
# 呼び出しが2つと数えられて deny になる。
gate_is_teardown() {
  gate_flatten "$1" \
    | grep -Eq '^[[:space:]]*git[[:space:]]+(rebase|merge|cherry-pick|am|revert)[[:space:]]+--(abort|quit|skip|edit-todo)[[:space:]]*$'
}

# コミット先が、このゲートを持っているプロジェクトのツリーかどうか。
#
# `gate_target_dir` は「宛先が自明か」しか見ていない。別のリポジトリで作業して
# いても宛先は自明に決まるので、そこへ `cd` して `npm run verify` を走らせて
# しまう。そのツリーに `package.json` は無いから必ず失敗し、**利用者は触っても
# いないファイルについて deny される。直す対象が存在せず、逃げ道も無い。**
#
# 比べるのは `--git-common-dir`。同じプロジェクトの別ワークツリーは共通の .git を
# 指すので一致し、ゲートの対象に残る。外れるのは別リポジトリだけ。
#
# 基準に `$CLAUDE_PROJECT_DIR` ではなく hook 自身の位置を使うのは、
# ワークツリーごとに値が変わらないため。
gate_in_project() {
  local target=$1 home=$2 target_dir home_dir
  [ -n "$target" ] || return 1
  target_dir=$(git -C "$target" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || return 1
  home_dir=$(git -C "$home" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || return 1
  [ -n "$target_dir" ] && [ "$target_dir" = "$home_dir" ]
}

# ゲート自身が置かれているツリー。`.claude/hooks/` の2つ上。
GATE_HOME=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)

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

# このプロジェクト以外のツリーには、このプロジェクトの検証を当てる筋合いが無い。
if ! gate_in_project "$project_dir" "$GATE_HOME"; then
  exit 0
fi

cd "$project_dir" || exit 0

# ステージ済みと作業ツリーの両方を見る（`git commit -a` を取りこぼさないため）。
#
# `-z` で読むのは、空白や非 ASCII を含むパスが `--porcelain` では引用符付きで
# 出るため。引用符が付いたままだと拡張子の判定が全て外れる。
# `-z` ではリネームが "XY new\0old\0" の2レコードで来るので、古い方も読む。
# 新しい方だけだと、`.rs` を別の拡張子へ改名するコミットが Rust の変更として
# 数えられない。
needs_ts=0
needs_rust=0
needs_gate=0
while IFS= read -r -d '' record; do
  status=${record:0:2}
  paths=${record:3}

  case "$status" in
    R*|C*)
      IFS= read -r -d '' original || original=""
      [ -n "$original" ] && paths="$paths
$original"
      ;;
  esac

  while IFS= read -r path; do
    [ -n "$path" ] || continue
    for kind in $(gate_kinds_for_path "$path"); do
      case "$kind" in
        ts) needs_ts=1 ;;
        rust) needs_rust=1 ;;
        gate) needs_gate=1 ;;
      esac
    done
  done <<EOF
$paths
EOF
done < <(git status --porcelain -z --untracked-files=no)

# 畳む操作は作業ツリーに何が載っていても検証が要らない。コミットを1つも
# 作らないので、検証すべき成果物がそもそも生まれない。
if gate_is_teardown "$command"; then
  needs_ts=0
  needs_rust=0
  needs_gate=0
fi

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
