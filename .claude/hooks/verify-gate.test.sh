#!/usr/bin/env bash
# verify-gate.sh の判定部分を固定する。`bash .claude/hooks/verify-gate.test.sh` で走る。
#
# 素通し（検証されないまま通る）は、誤発火（余分に検証が走るだけ）より危険が
# 大きい。素通しになる綴りを表にして固定する。
#
# 関数ごとに `expect_*` の表を置く。どの関数を固定しているかは、この下の
# `expect_*` の定義を見ること（数を書くと、表を足した人が必ず更新し忘れる）。

set -uo pipefail

cd "$(dirname "$0")/../.." || exit 1
GATE_LIB_ONLY=1 . .claude/hooks/verify-gate.sh

# **数え方をシェル変数に持たせない。**
# `expect_*` はサブシェルの中からも呼ばれる（`( export GIT_CONFIG_GLOBAL=…; … )`、
# `… | while read`）。変数に足すと、その加算は親へ戻らず、
# **FAIL の行を印字したまま suite が緑で終わる。**
# ファイルへ1行追記すれば、どの深さのサブシェルから呼ばれても親が数えられる。
GATE_TEST_FAILLOG=$(mktemp)
export GATE_TEST_FAILLOG
trap 'rm -f "$GATE_TEST_FAILLOG"' EXIT

count_failure() {
  printf 'x\n' >> "$GATE_TEST_FAILLOG"
}

expect_match() {
  local want=$1 command=$2
  local got=SKIP
  gate_matches_commit "$command" && got=CATCH
  if [ "$got" != "$want" ]; then
    printf 'FAIL  期待 %s / 実際 %s : %s\n' "$want" "$got" "$command"
    count_failure
  fi
}

# 見落としてはいけないもの
expect_match CATCH 'git commit -m x'
expect_match CATCH 'git commit'
expect_match CATCH 'cd /x && git commit -m x'
expect_match CATCH 'git -C /tmp/wt commit -m x'
expect_match CATCH 'git -C/tmp/wt commit -m x'
expect_match CATCH 'git --git-dir=/tmp/x/.git commit -m x'
expect_match CATCH 'git --git-dir /tmp/x/.git commit -m x'
expect_match CATCH 'git --work-tree /tmp/x --git-dir /tmp/x/.git commit -m x'
expect_match CATCH 'git --namespace foo commit'
expect_match CATCH 'git -c user.name=a commit'
expect_match CATCH 'git -c foo.bar commit -m x'

# オプションの値に空白が入っても commit まで届くこと。届かないとゲートは
# deny も検証もせずに素通しする。
expect_match CATCH "git -c 'user.name=A B' commit -m x"
expect_match CATCH 'git -c "user.name=A B" commit -m x'
expect_match CATCH "git -C '/tmp/My Books/repo' commit -m x"
expect_match CATCH 'git -C "/tmp/My Books/repo" commit -m x'
expect_match CATCH "git --work-tree '/tmp/My Books/r' --git-dir '/tmp/My Books/r/.git' commit -m x"

# 行を跨ぐ綴り。grep は行単位なので、畳まないとパターンが成立しない。
expect_match CATCH "$(printf 'git \\\n  commit -m x')"
expect_match CATCH "$(printf 'git -C /tmp/other \\\n  commit -m x')"

# git の綴りにパス修飾や引用が付く形
expect_match CATCH '/usr/bin/git commit -m x'
expect_match CATCH "'git' commit -m x"
expect_match CATCH '\git commit -m x'

# `-c` の次のトークンが設定名として消費されるので、`a` がサブコマンドになり
# commit へ到達しない。素通ししても検証されないコミットは生まれない。
expect_match SKIP 'git -c user.name a commit'

# commit 以外にもコミットを作るサブコマンドがある。見落とすと、出来たツリーが
# 一度も検証されないままコミットが増える。
expect_match CATCH 'git revert --no-edit HEAD'
expect_match CATCH 'git cherry-pick abc123'
expect_match CATCH 'git merge --no-ff feature'
expect_match CATCH 'git rebase --continue'
expect_match CATCH 'git rebase main'
expect_match CATCH 'git am /tmp/x.patch'
expect_match CATCH 'git pull'
expect_match CATCH 'git pull --rebase origin main'

# 語彙には当たる。免除は下の expect_teardown が別に見る
expect_match CATCH 'git merge --abort'

# commit ではないもの
expect_match SKIP 'git add -A'
expect_match SKIP 'git log --oneline'
expect_match SKIP 'npm run commit-helper'
expect_match SKIP 'echo commit'

# alias で付けた別名も拾うこと。`git ci` は綴りが利用者の設定で決まるので、
# 表は fixture（GATE_EXTRA_VERBS）で固定する。実際の設定に依存させると、
# alias を持たない環境では何も守らないテストになる。
expect_alias() {
  local want=$1 command=$2 verbs=$3
  local got=SKIP
  ( GATE_EXTRA_VERBS=$verbs gate_matches_commit "$command" ) && got=CATCH
  if [ "$got" != "$want" ]; then
    printf 'FAIL  期待 %s / 実際 %s : %s（alias=%s）\n' "$want" "$got" "$command" "$verbs"
    count_failure
  fi
}

expect_alias CATCH 'git ci -m x' 'ci'
expect_alias CATCH 'git cm -m x' 'ci|cm'
expect_alias SKIP 'git st' 'ci'
expect_alias SKIP 'git ci -m x' ''

# alias の解決そのものを見る表。`GATE_EXTRA_VERBS` は解決ロジックを丸ごと
# 差し替える seam なので、それでは展開先を辿る動きを固定できない。
# GIT_CONFIG_GLOBAL に fixture を置いて、実際の設定に依存させずに回す。
expect_alias_resolution() {
  local want=$1 config=$2
  local fixture got
  fixture=$(mktemp)
  printf '%s\n' "$config" > "$fixture"

  got=$(
    unset GATE_EXTRA_VERBS
    GIT_CONFIG_GLOBAL=$fixture GIT_CONFIG_SYSTEM=/dev/null GIT_CONFIG_NOSYSTEM=1 \
      bash -c 'GATE_LIB_ONLY=1 . .claude/hooks/verify-gate.sh; gate_alias_verbs'
  )
  rm -f "$fixture"

  if [ "$got" != "$want" ]; then
    printf 'FAIL  期待 %s / 実際 %s : %s\n' "${want:-（無し）}" "${got:-（無し）}" "$config"
    count_failure
  fi
}

expect_alias_resolution "ci" "[alias]
	ci = commit
	st = status"
# 展開先が別の alias のときも辿ること。1周で止めると acp が素通しする
expect_alias_resolution "ci|acp" "[alias]
	ci = commit
	acp = !f() { git ci -m \"\$1\"; }; f
	st = status"
expect_alias_resolution "" "[alias]
	st = status
	co = checkout"

# 値に生の改行が入る形。素で読むと2行目以降が alias. で始まらず、名前を
# 切り出せない。取りこぼすとその alias が素通しする
expect_alias_resolution "acp" "[alias]
	acp = \"!f() { \\n git commit -m x \\n }; f\"
	st = status"

expect_mentions() {
  local want=$1 command=$2
  local got=SKIP
  gate_mentions_commit "$command" && got=CATCH
  if [ "$got" != "$want" ]; then
    printf 'FAIL  期待 %s / 実際 %s : %s\n' "$want" "$got" "$command"
    count_failure
  fi
}

# 呼び出しとして切り出せない綴りは、最後の網で拾って deny 側へ落とす。
expect_mentions CATCH '$(which git) commit -m x'
expect_mentions CATCH 'x=git; $x commit -m y'
expect_mentions SKIP 'npm run commit-helper'
expect_mentions SKIP 'git log --oneline'
expect_mentions SKIP 'echo commit'

# J: commit を作らないのに `git` と動詞が同じコマンドに並ぶ形。
# **無条件 deny になる唯一の行**（不変条件3の例外）なので、
# ここが将来ゆるんだとき「誤発火が消えた」のか「穴が開いた」のかを区別できるようにする
expect_mentions CATCH 'gh pr create --title "fix: git commit を直す"'
expect_mentions CATCH 'grep -rn "git commit" docs/'
expect_match SKIP 'gh pr create --title "fix: git commit を直す"' 

expect_dir() {
  local want=$1 command=$2 base=$3
  local got
  got=$(gate_target_dir "$command" "$base")
  if [ "$got" != "$want" ]; then
    printf 'FAIL  期待 %s / 実際 %s : %s\n' "${want:-（空）}" "${got:-（空）}" "$command"
    count_failure
  fi
}

here=$(git rev-parse --show-toplevel)
other=$(git worktree list --porcelain | awk '/^worktree /{print $2}' | grep -v "^$here$" | head -1)

# 宛先が自明な形。起点の作業ディレクトリで commit が1つだけ走る。
expect_dir "$here" 'git commit -m x' "$here"
expect_dir "$here" 'git commit -m "fix: 直した"' "$here"
# git の綴りにパス修飾や引用が付いても、宛先は起点のまま（deny にはならない）
expect_dir "$here" '/usr/bin/git commit -m x' "$here"
expect_dir "$here" "'git' commit -m x" "$here"
# メッセージ本文に git commit と書いただけで「呼び出しが2つ」と数えないこと。
# ゲートの説明を書いたコミットほど止まる形になる。
expect_dir "$here" 'git commit -m "fix: git commit の検出を直す"' "$here"
expect_dir "$here" "git commit -m 'docs: git rebase の話'" "$here"
# 単一引用符の中では何も走らないので、$ を含んでいても潰してよい
expect_dir "$here" "git commit -m 'fix: 値段は \$5 だが git commit の話'" "$here"
[ -n "$other" ] && expect_dir "$other" 'git commit -m x' "$other"

# 宛先が自明でない綴りは、素通しさせずに deny 側へ落とす。
# 「解決しようとして間違える」より「止める」を選んだ結果なので、
# ここに並ぶ綴りが増えても deny のままでよい。
target=${other:-/tmp}
expect_dir "" "git -C $target commit -m x" "$here"
expect_dir "" "git --work-tree $target --git-dir $target/.git commit -m x" "$here"
expect_dir "" 'git --git-dir=/tmp/x/.git commit -m x' "$here"
expect_dir "" "cd $target && git commit -m x" "$here"
expect_dir "" "cd '$target' && git commit -m x" "$here"
expect_dir "" "cd $target; git commit -m x" "$here"

# **ツリーを変える git を手前に置いた形。** 判定はコマンドが走る前なので、
# 手前で変えるとその前の状態を見る。`git rm X && git commit` は X がまだ在る
# 状態を走査して「変更なし」と読み、検証も deny もせずに素通ししていた。
expect_dir "" "git rm src/app/App.tsx && git commit -m x" "$here"
expect_dir "" "git add -A && git commit -m x" "$here"
expect_dir "" "git mv a.rs b.rs && git commit -m x" "$here"
expect_dir "" "git stash pop && git commit -am x" "$here"
expect_dir "" "git checkout main -- src && git commit -am x" "$here"
expect_dir "" "git restore --source=main -- src/foo.ts && git commit -am x" "$here"
expect_dir "" "git reset --hard && git commit -m x" "$here"

# **バッククォートの中身は、手前の許可リストを1文字も通らない。**
# 先頭の語は読むだけの動詞なので正規表現は通り、その引数の中で別の git が走る。
# `$( )` は `(` を弾く文字クラスに引っ掛かるが、こちらは記号として素通りする。
expect_dir "" 'git status `git rm -f src/app/App.tsx` && git commit -m x' "$here"
expect_dir "" 'git log -1 `git checkout main -- src` && git commit -am x' "$here"

# 読むだけの git は手前に置いてよい。**塞ぎすぎると、いま通っている綴りが止まる。**
expect_dir "$here" "git status && git commit -m x" "$here"
expect_dir "$here" "git diff --cached && git commit -m x" "$here"
expect_dir "$here" "git log --oneline -1 && git commit -m x" "$here"

# 読むだけの動詞でも、`--output=` は追跡ファイルを潰せる。
# `>` は正規表現が弾くが、これは記号を使わずに同じことをする
expect_dir "" "git diff --output=src/app/App.tsx && git commit -am x" "$here"
expect_dir "" "git log --output=x.ts -1 && git commit -am x" "$here"

# **alias の展開先まで見る。** 先頭の語だけで許すと、
# 打った文字列に `--output` が1文字も出ない形で丸ごと抜ける
#
# fixture は global だけでなく system と local からも切り離す。
# `git config --get-regexp` は3つを混ぜて列挙するので、global を差し替えても
# **手元の repo か system に同名の alias が1つあるだけで結果が変わる。**
# local は環境変数では切れないので、リポジトリの外へ出て問い合わせる。
# **`gate_target_dir` の答えは cwd に依る** —— 最終行の `rev-parse` は `$base` を
# 明示するが、途中で呼ぶ `gate_read_only_verbs` と `gate_alias_verbs` は
# `-C` の無い `git config` を引く。外へ出るのは、その依存を断つため。
# 名前も `d` / `st` のような衝突しやすい短縮を避ける。
(
  cd "$(mktemp -d)" || exit 1
  cfg=$(mktemp)
  printf '[alias]\n\tgatetestd = diff --output=src/app/App.tsx\n\tgatetestcfg = config -f rust-toolchain.toml\n\tgatetestst = status\n' > "$cfg"
  export GIT_CONFIG_GLOBAL=$cfg
  export GIT_CONFIG_SYSTEM=/dev/null
  export GIT_CONFIG_NOSYSTEM=1
  unset GATE_EXTRA_READ_ONLY
  expect_dir "" "git gatetestd && git commit -am x" "$here"
  expect_dir "" "git gatetestcfg a.b c && git commit -am x" "$here"
  expect_dir "$here" "git gatetestst && git commit -m x" "$here"
  rm -f "$cfg"
)

# 読むだけの動詞へ展開する alias も手前に置ける。
# **止めても利用者にできることは「2回に分ける」だけ**で、ツリーは変わらないのに
# 手数だけ増える。`GATE_EXTRA_READ_ONLY` で alias 名を差し込んで固定する。
(
  export GATE_EXTRA_READ_ONLY='st|lg'
  expect_dir "$here" "git st && git commit -m x" "$here"
  expect_dir "$here" "git lg && git commit -m x" "$here"
  # 展開先が読むだけでない alias は、名前が短くても手前に置けない
  expect_dir "" "git unstage && git commit -m x" "$here"
)
expect_dir "" "cd $target&&git commit -m x" "$here"
expect_dir "" "(cd $target && git commit -m x)" "$here"
expect_dir "" "pushd $target && git commit -m x" "$here"
expect_dir "" "builtin cd $target && git commit -m x" "$here"
expect_dir "" "env -C $target git commit -m x" "$here"
expect_dir "" "env --chdir=$target git commit -m x" "$here"
expect_dir "" "sh -c 'cd $target && git commit -m x'" "$here"
expect_dir "" 'cd $TARGET && git commit -m x' "$here"
expect_dir "" 'cd ~/obs-shogi && git commit -m x' "$here"
expect_dir "" 'cd $(dirname /tmp/x) && git commit -m x' "$here"
expect_dir "" 'git commit -m a && git commit -m b' "$here"
# 引用の中で本当にコマンドが走る形は、潰さずに数える
expect_dir "" 'git commit -m "$(cd /tmp && git commit -m x)"' "$here"
# 語中のアポストロフィを引用の開始と読むと、そこから次の ' までが消えて
# 間の cd と2つ目の呼び出しが見えなくなる
expect_dir "" 'git commit -m "don'"'"'t" && cd /tmp && git commit -m "won'"'"'t"' "$here"
expect_dir "" "GIT_DIR=$target/.git GIT_WORK_TREE=$target git commit -m x" "$here"
expect_dir "" "GIT_INDEX_FILE=/tmp/i git commit -m x" "$here"
expect_dir "" 'nohup git commit -m x' "$here"
expect_dir "" 'ssh host git commit -m x' "$here"
expect_dir "" 'npm run build && git commit -m x' "$here"
expect_dir "" 'git commit -m x' /nonexistent/not-a-repo


expect_kinds() {
  local want=$1 path=$2
  local got
  got=$(gate_kinds_for_path "$path")
  if [ "$got" != "$want" ]; then
    printf 'FAIL  期待 %s / 実際 %s : %s\n' "${want:-（無し）}" "${got:-（無し）}" "$path"
    count_failure
  fi
}

# どのファイル種別でどの検証を選ぶか。
expect_kinds "ts" "src/app/App.tsx"
expect_kinds "ts" "src/shared/ui/Button.ts"
expect_kinds "ts" "src/index.scss"
expect_kinds "ts" "package.json"
# `.rs` は両方。`src/__tests__/` の規約の検査には **Rust のソースを走査する
# もの**があり、それは vitest でしか走らない。rust だけにすると、Rust しか
# 触らないコミットでその検査が一度も走らない。
expect_kinds "ts rust" "src-tauri/src/book/api.rs"
expect_kinds "ts rust" "src-tauri/tests/root_guard.rs"
expect_kinds "rust" "src-tauri/Cargo.toml"
expect_kinds "rust" "src-tauri/tauri.conf.json"
expect_kinds "rust" "src-tauri/capabilities/default.json"
expect_kinds "rust" "rust-toolchain.toml"
expect_kinds "ts" ".claude/hooks/verify-gate.sh"
expect_kinds "" "README.md"
# `ratchetIndex` が索引としてこの表を読むので、触ったら vitest を通す
expect_kinds "ts" "CONTRIBUTING.md"
# docs の中は深さを問わず ts。リンクの検査が docs 全体に掛かっている
expect_kinds "ts" "docs/decisions/0002-drop-book-read-write.md"
expect_kinds "ts" "docs/spec/screens/board.md"
expect_kinds "ts" "docs/IDEAS.md"
# 状態遷移表は rust 側も見るので、表だけのコミットで2つとも走らせる
expect_kinds "ts rust" "docs/state-transitions/yaneuraou-db-parse.md"
expect_kinds "" ".claude/reviews/2026-08-30-book-foundation-r1.md"
# 引用符付きのパスは -z で読むので、ここへは素のまま来る
expect_kinds "ts" "src/dir with space/a.ts"

# 積んだ操作を畳む呼び出しは、検証の対象にしない。理由は `gate_is_teardown` の上。
expect_teardown() {
  local want=$1 command=$2
  local got=NO
  gate_is_teardown "$command" && got=YES
  if [ "$got" != "$want" ]; then
    printf 'FAIL  期待 %s / 実際 %s : %s\n' "$want" "$got" "$command"
    count_failure
  fi
}

expect_teardown YES 'git rebase --abort'
expect_teardown YES 'git rebase --quit'
expect_teardown YES 'git rebase --skip'
expect_teardown YES 'git rebase --edit-todo'
expect_teardown YES 'git merge --abort'
expect_teardown YES 'git cherry-pick --abort'
expect_teardown YES 'git am --abort'
expect_teardown YES 'git revert --quit'
expect_teardown YES '  git   merge   --abort  '

# --continue が作るコミットの中身は手元のツリーそのものなので、免除しない
expect_teardown NO 'git rebase --continue'
expect_teardown NO 'git cherry-pick --continue'

# コミットを作る呼び出しを混ぜたものへ免除を広げない
expect_teardown NO 'git rebase --abort && git commit -m x'
expect_teardown NO 'git commit -m x && git rebase --abort'
expect_teardown NO 'git commit --amend'

# ディレクトリ指定の付いた綴りは免除しない。宛先が別ツリーでも gate_target_dir が
# 先に deny するので、免除を広げても届かない
expect_teardown NO 'git -C /tmp/other rebase --abort'

# 宛先が別リポジトリなら、このプロジェクトの検証は当てない。
#
# 当てると、そのツリーに `package.json` が無いという理由で deny になり、
# 利用者には触ってもいないファイルについて直す対象が示される。
expect_project() {
  local want=$1 target=$2
  local got=OUT
  gate_in_project "$target" "$GATE_HOME" && got=IN
  if [ "$got" != "$want" ]; then
    printf 'FAIL  期待 %s / 実際 %s : %s\n' "$want" "$got" "$target"
    count_failure
  fi
}

# このワークツリー自身と、本チェックアウト（共通の .git を指すので一致する）
expect_project IN "$GATE_HOME"
expect_project IN "$(git -C "$GATE_HOME" rev-parse --path-format=absolute --git-common-dir | sed 's|/\.git$||')"

# 無関係なリポジトリ
gate_other_repo=$(mktemp -d)
git -C "$gate_other_repo" init -q
expect_project OUT "$gate_other_repo"
rm -rf "$gate_other_repo"

# リポジトリですらない場所
expect_project OUT "$(mktemp -d)"
expect_project OUT ""


# --- 許可した動詞が本当に読むだけか ---
#
# **眺めて決めない。** 使い捨ての repo で1つずつ実際に当て、作業ツリーと
# `HEAD` が動かないことを見る。`config` はこれで落ちた
# （`git config -f <追跡ファイル>` は `rust-toolchain.toml` のように
# git config として解釈できるファイルを書き換える）。
#
# **当てる綴りを1つで済ませない。** `-f <ファイル> a.b c` は `git config` の形なので、
# 他の動詞に当てると必ず usage error で終わる —— それでは `config` 以外について
# 何も確かめたことにならず、`checkout` を足した人が緑のまま通る。
# 動詞ごとに「その動詞が書き込む綴り」を並べて全部当てる。
gate_write_spellings=(
  ""
  "-f rust-toolchain.toml a.b c"
  "rust-toolchain.toml"
  "-f rust-toolchain.toml"
  "-- rust-toolchain.toml"
  "-- tracked.txt"
  "--hard"
  "-A"
  "-m x"
  "-fd ."
  "push"
  "pop"
  "HEAD"
  "main"
)

# 読むだけなら 0、何かを書いたら 1。
probe_is_readonly() {
  local verb=$1 spelling
  local repo before after head_before head_after files_before files_after rc=0
  repo=$(mktemp -d)
  (
    cd "$repo" || exit 1
    git init -q .
    git config user.email a@b
    git config user.name c
    printf '[toolchain]\nchannel = "stable"\n' > rust-toolchain.toml
    printf 'tracked\n' > tracked.txt
    git add -A
    git commit -qm init
    # 書き込む動詞が触る材料を一通り置く。素の repo だと `commit` も
    # `checkout --` も「変えるものが無い」ので動かず、読むだけに見える
    printf 'unstaged\n' >> tracked.txt
    printf 'staged\n' > staged.txt
    git add staged.txt
    printf 'untracked\n' > untracked.txt
  ) >/dev/null 2>&1

  # **綴りを1つ当てるたびに突き合わせる。** まとめて最後に1回だけ見ると、
  # 表の中で打ち消し合う組（`stash` と `stash pop`）が「変わっていない」に見える。
  for spelling in "${gate_write_spellings[@]}"; do
    before=$(git -C "$repo" status --porcelain)
    head_before=$(git -C "$repo" rev-parse HEAD)
    files_before=$(ls -A "$repo" | sort)

    # 意図的に分割する。1要素で複数の引数を渡すため
    # shellcheck disable=SC2086
    git -C "$repo" "$verb" $spelling >/dev/null 2>&1

    after=$(git -C "$repo" status --porcelain)
    head_after=$(git -C "$repo" rev-parse HEAD)
    files_after=$(ls -A "$repo" | sort)

    if [ "$before" != "$after" ] || [ "$head_before" != "$head_after" ] \
      || [ "$files_before" != "$files_after" ]; then
      rc=1
      break
    fi
  done

  rm -rf "$repo"
  return "$rc"
}

expect_readonly() {
  local verb=$1
  probe_is_readonly "$verb" && return 0
  printf 'FAIL  読むだけではない動詞が許可リストに入っている: %s\n' "$verb"
  count_failure
}

# **当て方そのものを先に見る。** 落とせない綴りしか当てていなければ、
# 下のループは緑で回り続けるだけで何も守らない。
for gate_writer in add rm checkout restore reset commit config stash clean; do
  if probe_is_readonly "$gate_writer"; then
    printf 'FAIL  書き込む動詞を「読むだけ」と判定している: %s\n' "$gate_writer"
    count_failure
  fi
done

# `|` で区切った一覧を `for` に載せる。`| while read` にすると末尾に改行が無く、
# **一覧の最後の動詞が一度も当たらない**（追記する人が最も自然に置く位置）。
# shellcheck disable=SC2086
for gate_verb in ${GATE_READ_ONLY_VERBS_BASE//|/ }; do
  expect_readonly "$gate_verb"
done

# --- hook の入口 ---
#
# **ここまでのケースは全て `GATE_LIB_ONLY=1` の関数呼び出し**で、
# 入口（payload を読む段）を1つも通っていない。
# 入口が壊れると症状は「静かに全部通る」になり、下の判定は1つも走らない。
gate_entry() {
  printf '%s' "$2" | env "$1" /bin/bash "$(dirname "$0")/verify-gate.sh" 2>/dev/null \
    | grep -o '"permissionDecision": *"[a-z]*"' | head -1
}

expect_entry() {
  local want=$1 label=$2 got=$3
  if [ "$want" = "$got" ]; then
    return 0
  fi
  printf 'FAIL  期待 %s / 実際 %s : %s\n' "${want:-（空）}" "${got:-（空）}" "$label"
  count_failure
}

# payload が空なら deny。読めないまま素通しさせない
expect_entry '"permissionDecision":"deny"' 'payload が空' \
  "$(printf '' | /bin/bash "$(dirname "$0")/verify-gate.sh" 2>/dev/null \
     | tr -d ' \n' | grep -o '"permissionDecision":"[a-z]*"' | head -1)"

# jq が無くても deny。**macOS に標準で入っていない**
expect_entry '"permissionDecision":"deny"' 'jq が無い' \
  "$(printf '{"tool_input":{"command":"x"}}' \
     | PATH= /bin/bash "$(dirname "$0")/verify-gate.sh" 2>/dev/null \
     | tr -d ' \n' | grep -o '"permissionDecision":"[a-z]*"' | head -1)"

# payload の形が変わっても deny。**`// ""` で既定値へ倒すと、
# フィールドが消えた日に全 Bash 呼び出しが無言で通る**
expect_entry '"permissionDecision":"deny"' 'command 欄が無い' \
  "$(printf '{"tool_input":{"cmd":"x"}}' \
     | /bin/bash "$(dirname "$0")/verify-gate.sh" 2>/dev/null \
     | tr -d ' \n' | grep -o '"permissionDecision":"[a-z]*"' | head -1)"

# --- 集計そのものを見る ---
#
# **この suite が緑で終わることを、緑の根拠にしてよいのはここが通ったときだけ。**
# 失敗をサブシェルの中だけで数えると、FAIL の行は出るのに exit 0 で終わる。
# わざと1件落として、それが集計へ届くことを見る。
before=$(wc -l < "$GATE_TEST_FAILLOG" | tr -d ' ')
( count_failure ) # 一番浅いサブシェル。深くしても同じ経路を通る
after=$(wc -l < "$GATE_TEST_FAILLOG" | tr -d ' ')
if [ "$after" -eq "$((before + 1))" ]; then
  : > "$GATE_TEST_FAILLOG"
  [ "$before" -gt 0 ] && for _ in $(seq "$before"); do count_failure; done
else
  printf 'FAIL  失敗の数え方が壊れている（サブシェルからの1件が集計に届かない）\n'
  exit 1
fi

failures=$(wc -l < "$GATE_TEST_FAILLOG" | tr -d ' ')
if [ "$failures" -eq 0 ]; then
  echo "verify-gate: 全て期待どおり"
  exit 0
fi

printf 'verify-gate: %d件が期待と違う\n' "$failures"
exit 1
