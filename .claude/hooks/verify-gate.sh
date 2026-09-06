#!/usr/bin/env bash
# PreToolUse(Bash) ゲート: 検証を通していない `git commit` を止める。
#
# 変更ファイルの種類だけを見て、必要な verify を選んで走らせる。
# どの種類がどれを呼ぶかは `gate_kinds_for_path` が唯一の出典（ここに写さない。
# 2箇所に書くと必ず片方が腐る）。見えた変更のどれも種類に当たらなければ素通しする
# （畳む操作の免除を含む判定の全体は `docs/state-transitions/verify-gate-decision.md`）。
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

# ツリーを変えない git の動詞。**手前に置いてよいのはこれだけ。**
#
# 増やすときは「その呼び出しの後で `git status` の結果が変わらないか」で決める。
# **眺めて決めない** —— `verify-gate.test.sh` の `expect_readonly` が、
# 使い捨ての repo で1つずつ実際に当てて確かめる。
# `config` はここに入らない: `git config -f <追跡ファイル>` は
# `rust-toolchain.toml` のように git config として解釈できるファイルを書き換える。
GATE_READ_ONLY_VERBS_BASE='status|diff|log|show|rev-parse|branch|fetch|remote|describe'

# 上に加えて、**それらへ展開する alias**。
#
# `st = status` のような短縮は普通に置かれるので、名前だけで見ると
# 読むだけの呼び出しが止まる。**止めても利用者にできることは
# 「2回に分ける」だけ**で、ツリーは1バイトも変わらないのに手数だけ増える。
# `GATE_EXTRA_READ_ONLY` で差し込めるようにしてある（テストから固定するため）。
# alias を引くリポジトリ。**hook 自身の cwd ではない。**
#
# `git config` は local を混ぜて列挙するので、どこで引くかで答えが変わる。
# hook が走る場所とコマンドが走る場所は一致しないことがあり、
# 引く場所を間違えると repo-local の commit alias（`git ci`）が見えない ——
# S1 で切り出せず、`gate_mentions_commit` は基本の動詞しか知らないので、
# **deny も検証もされないまま通る。**
#
# 入口が payload の `cwd` を入れる。テストからも差し込める。
gate_config_at() {
  git -C "${GATE_BASE:-.}" config "$@"
}

gate_read_only_verbs() {
  if [ -n "${GATE_EXTRA_READ_ONLY+set}" ]; then
    printf '%s' "$GATE_READ_ONLY_VERBS_BASE${GATE_EXTRA_READ_ONLY:+|$GATE_EXTRA_READ_ONLY}"
    return 0
  fi

  local config names
  config=$(gate_config_at -z --get-regexp '^alias\.[^.]+$' 2>/dev/null \
    | tr '\n' ' ' | tr '\0' '\n') || {
    printf '%s' "$GATE_READ_ONLY_VERBS_BASE"
    return 0
  }

  # 展開先の先頭の語が読むだけの動詞で、**かつ展開先に書き込む綴りが無い**なら、
  # その alias 名も手前に置ける。
  #
  # **展開先まで見る。** 先頭の語だけで許すと、`d = diff --output=x` のような
  # alias が `git d && ...` の形で丸ごと抜ける —— 打った文字列に `--output` が
  # 1文字も出ないので、下の `case` の弾きにも当たらない。
  names=$(printf '%s\n' "$config" \
    | sed -n "s/^alias\.\([^ ]*\) *\([^ !].*\)$/\1 \2/p" \
    | awk -v ro="$GATE_READ_ONLY_VERBS_BASE" '
        BEGIN { n = split(ro, a, "|"); for (i = 1; i <= n; i++) ok[a[i]] = 1 }
        !ok[$2] { next }
        /--output|(^| )-f( |$)|--file|--edit|--unset|--add|--replace-all/ { next }
        { printf "|%s", $1 }')

  printf '%s%s' "$GATE_READ_ONLY_VERBS_BASE" "$names"
}

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
  config=$(gate_config_at -z --get-regexp '^alias\.[^.]+$' 2>/dev/null \
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
#
# **alias 由来の名前はここでは見ない**（`GATE_COMMIT_VERB_BASE` だけを使う）。
# alias 名は利用者が短く付けるので、`ci` を持つ環境では `.github/workflows/ci.yml` を
# 触るだけの読み取りコマンドが軒並み止まる —— **コミットを1つも作らないのに、
# 案内はコミットの打ち方を指示する**ので、従える操作が1つも無い。
# `git ci -m x` は `gate_commit_call` が構造として切り出すので、
# alias がこの網に載っている必要は無い。
# 抜けるのは「切り出せない綴り＋alias」が同時に成り立つ場合だけ。
gate_mentions_commit() {
  local flat
  flat=$(gate_flatten "$1")
  printf '%s' "$flat" | grep -Eq '(^|[^[:alnum:]_.-])git([^[:alnum:]_-]|$)' \
    && printf '%s' "$flat" | grep -Eq "(^|[^[:alnum:]_-])($GATE_COMMIT_VERB_BASE)([^[:alnum:]_-]|\$)"
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
  # 手前の許可リストも alias を引く。起点が渡っているならそこで引く
  local GATE_BASE=$base

  call=$(gate_commit_call "$command")
  [ -n "$call" ] || return 0

  # コミットを作る呼び出しが2つ以上あるなら、別々のツリーへ入りうる。
  [ "$(gate_commit_count "$command")" -eq 1 ] || return 0

  # git 自身のディレクトリ指定。
  case "$call" in
    *-C*|*--git-dir*|*--work-tree*|*--namespace*) return 0 ;;
  esac

  # 手前に置いてよいのは、**コミットされる中身を変えない git 呼び出しだけ**。
  #
  # PreToolUse はコマンドが走る前に判定するので、手前の呼び出しがツリーを変えると
  # **その前の状態を見る**。`git rm X && git commit` は、判定した時点では X がまだ
  # 在るので変更が1つも見えず、種類が空のまま素通しする ——
  # コンパイルが通らないコミットが検証も deny もされずに積まれる。
  # `git add` / `git mv` / `git stash pop` / `git checkout --` も同じ。
  # 走査の仕方を変えても閉じない（消される側・これから現れる側は原理的に見えない）ので、
  # **手前に置ける動詞を列挙する側で塞ぐ。**
  #
  # 2回の呼び出しに分ければ従来どおり打てる。
  flat=$(gate_strip_quotes "$command")
  prefix=${flat%"$call"*}
  # 空の prefix も1行として渡す。printf '%s' だと行が無く、grep が必ず外れる。
  printf '%s\n' "$prefix" \
    | grep -Eq "^[[:space:]]*(git[[:space:]]+($(gate_read_only_verbs))([[:space:]][^;&|()<>]*)?(&&|;)[[:space:]]*)*$" \
    || return 0

  # **置換は手前だけでなく、呼び出し自身の引数の中でも走る。**
  # `git commit -m x \`git rm -f X\`` は上の正規表現から見れば prefix が空 ——
  # 「手前に何も無い」ので通る。だがシェルは `git commit` を起動する前に
  # 置換を実行するので、`git rm X && git commit` と結果は同じ。
  # 走査した時点では X がまだ在り、ツリーが他に何も持っていなければ
  # 種類が空になって素通しする。**手前を列挙する側では閉じない。**
  #
  # `$( )` と `<( )` `>( )` は prefix の文字クラスが弾くが、それも手前だけ。
  # ここは畳んだコマンド全体を見る。
  # 2回の呼び出しに分ければ従来どおり打てる（メッセージはファイルへ書いて
  # `--file=` で渡す）。
  case "$flat" in
    *'`'*|*'$('*|*'<('*|*'>('*) return 0 ;;
  esac

  case "$prefix" in
    # `>` は上の正規表現が弾くが、`--output=` は同じことを記号なしで行う。
    # 読むだけの動詞でも追跡ファイルを潰せるので、宛先不明として落とす。
    *--output*) return 0 ;;
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

  # `.rs` がここにも入るのは、`src/__tests__/` の規約の検査のうち
  # **Rust のソースを走査するもの**（コメントに経緯を書かない、など）が
  # vitest でしか走らないため。rust だけに分類すると、Rust しか触らない
  # コミットでその検査が一度も走らない。
  case "$path" in
    *.ts|*.tsx|*.scss|*.rs|tsconfig*.json|vite.config.ts|package.json|package-lock.json) kinds="ts" ;;
  esac
  case "$path" in
    *.rs|*Cargo.toml|*Cargo.lock|src-tauri/tauri.conf.json|src-tauri/capabilities/*.json|rust-toolchain.toml)
      kinds="$kinds rust" ;;
  esac
  # ts 側にはリンクの検査があり、`docs/` 全体に掛かっている。
  # `case` の `*` は `/` にも当たるので、この1つで深さを問わず拾う。
  #
  # **doc だけのコミットは、その検査を破れる唯一の形。** 分類から外すと、
  # 落ちるのは PR を上げた後の CI になる。
  #
  # **どの検査が掛かるかを数えて書かない。** ts 側の検査は増える。件数や名前を
  # ここに書くと、1本畳んだ人が「もう ts は要らない」と読んで分類ごと戻す。
  case "$path" in
    docs/*.md|CONTRIBUTING.md) kinds="$kinds ts" ;;
  esac
  # 状態遷移表は rust 側も見る。表の登録漏れ（足した表がどちらの一覧にも載っていない）と、
  # 表のセルが名乗る定数の実在を、Rust 側の integration test が見ている。
  # 表だけを直したコミットで飛ばすと、そこが一度も走らない。
  case "$path" in
    docs/state-transitions/*.md) kinds="$kinds rust" ;;
  esac
  case "$path" in
    # **門番自身も `ts`。** `npm run verify` は最後に `test:hooks`（門番の検査）を
    # 走らせるうえ、`docsIdentifiers` が `.claude/hooks/*.sh` を走査する
    # ——シェルは判定表が引く関数名の唯一の定義元。専用の種類は要らない。
    .claude/hooks/*.sh) kinds="$kinds ts" ;;
  esac

  printf '%s' "${kinds# }"
}

# 積んだ操作を畳む呼び出し。検証の対象にしない。
#
# 拾うのは `rebase` / `merge` / `cherry-pick` / `am` / `revert` の
# `--abort` / `--quit` / `--skip` / `--edit-todo`。
#
# **根拠は「コミットを作らないから」でも「途中のツリーでしか打てないから」でもない。**
# 前者が言えるのは `--abort` / `--quit` / `--edit-todo` の3つだけで、`--skip` は
# 中断ではなく続行、残りの patch を当ててコミットを作る。後者も
# `merge` / `cherry-pick` / `revert` の `--quit` で破れる —— 操作が走っていない
# ツリーでも rc=0 で通る（何もしないだけ）。
#
# 根拠は2つ。**作るとしても、中身が手元のツリーではない** —— `--skip` が当てるのは
# 積んである patch なので、いま見えている変更を検証しても当たらない。
# そして**deny すると出口が消えることがある** —— 手元のツリーで検証が落ちるなら、
# 畳む手段そのものが取り上げられる。案内文も「再度コミットすること」になり、
# コミットしようとしていない利用者に従える操作が1つも無い。
# **どのファイルが競合したら落ちるかは書かない。** 種類と検査の対応は増減するし、
# 種類に当たっても落ちない組み合わせが実在する。
#
# 1つ目だけでは切り出せない。`git merge topic` も作るコミットの中身は手元のツリーでは
# ないが、こちらは免除しない —— deny されても普通にやり直せるので、2つ目が当たらない。
#
# `--continue` は入れない。**あれが作るコミットの中身は手元のツリーそのもの**なので
# 1つ目が当たらない。免除は2つの連言なので、これだけで外れる。
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

# **読めなかったときは deny 側へ倒す。**
#
# jq は macOS に標準で入っていない。握り潰すと、新しいマシンで clone した人は
# **ゲートが1度も走らないまま**「コミットが通ったから検証も通った」と読む。
# payload の形が将来変わったときも症状は同じ（静かに全部通る）。
if ! command -v jq >/dev/null 2>&1; then
  # deny 自体が jq を使うので、ここだけは固定の JSON を出す
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"検証ゲート: jq が無いので判定できない。jq を入れること。"}}'
  exit 0
fi

payload=$(cat)

# 空も deny 側。**握り潰すと、渡し方が壊れた日に静かに全部通る。**
if [ -z "$payload" ]; then
  deny "検証ゲート: payload が空で、何を実行しようとしているのか読めなかった。
hook の渡し方が変わっていないか確かめること。"
fi

# **`// ""` で既定値へ倒さない。** フィールドが無くても jq は成功するので、
# 空のコマンドとして扱うと**形が変わった日に全 Bash 呼び出しが無言で通る。**
# `-e` は null / 欠落で非0を返すので、そこを deny 側へ落とす。
# matcher は `Bash` 固定なのでこの欄は実運用では必ず在り、正常系は止まらない。
command=$(printf '%s' "$payload" | jq -er '.tool_input.command') || {
  deny "検証ゲート: payload に実行しようとしているコマンドが入っていない。
hook の渡し方が変わっていないか確かめること。"
}
cwd=$(printf '%s' "$payload" | jq -r '.cwd // ""')

# **alias はコマンドが走る場所で引く。** hook 自身の cwd で引くと、
# その repo にしか無い commit alias が見えないまま素通しする。
GATE_BASE=${cwd:-$PWD}

if ! gate_matches_commit "$command"; then
  # 呼び出しとして切り出せないのに git と commit が並んでいるなら、綴りを
  # 言い当てられなかったということ。素通しさせない。
  gate_mentions_commit "$command" || exit 0
  gate_unknown_spelling=1
fi


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
1つのコマンドに commit を2つ以上並べないこと。
**手前に置けるのは読むだけの git だけ**（$(gate_read_only_verbs | tr '|' ' ')
と、それらへ展開する alias）。**\`--output=\` は付けないこと** ——
読むだけの動詞でも追跡ファイルを潰せる。
判定はコマンドが走る前なので、手前で変えるとその前の状態を見ることになる。
それ以外は別の呼び出しに分けること。"
fi

# このプロジェクト以外のツリーには、このプロジェクトの検証を当てる筋合いが無い。
if ! gate_in_project "$project_dir" "$GATE_HOME"; then
  exit 0
fi

cd "$project_dir" || deny "検証ゲート: 対象のツリーへ移動できなかった: $project_dir"

# ステージ済みと作業ツリーの両方を見る（`git commit -a` を取りこぼさないため）。
#
# `-z` で読むのは、空白や非 ASCII を含むパスが `--porcelain` では引用符付きで
# 出るため。引用符が付いたままだと拡張子の判定が全て外れる。
# `-z` ではリネームが "XY new\0old\0" の2レコードで来るので、古い方も読む。
# 新しい方だけだと、`.rs` を別の拡張子へ改名するコミットが Rust の変更として
# 数えられない。
needs_ts=0
needs_rust=0
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
      esac
    done
  done <<EOF
$paths
EOF
done < <(git status --porcelain -z --untracked-files=no)

# 畳む操作は作業ツリーに何が載っていても検証が要らない。理由は `gate_is_teardown`。
if gate_is_teardown "$command"; then
  needs_ts=0
  needs_rust=0
fi

if [ "$needs_ts" -eq 0 ] && [ "$needs_rust" -eq 0 ]; then
  exit 0
fi

run_gate() {
  local label=$1 out
  if ! out=$("${@:2}" 2>&1); then
    deny "検証ゲート失敗: ${label}（${project_dir}）

$(printf '%s' "$out" | tail -40)

コミットは実行していない。上を直してから再度コミットすること。
検証を飛ばして「完了」と報告しないこと。"
  fi
}

[ "$needs_ts" -eq 1 ] && run_gate "npm run verify" npm run verify
[ "$needs_rust" -eq 1 ] && run_gate "npm run verify:rust" npm run verify:rust

exit 0
