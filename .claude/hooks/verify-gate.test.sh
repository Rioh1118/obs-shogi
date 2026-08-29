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

failures=0

expect_match() {
  local want=$1 command=$2
  local got=SKIP
  gate_matches_commit "$command" && got=CATCH
  if [ "$got" != "$want" ]; then
    printf 'FAIL  期待 %s / 実際 %s : %s\n' "$want" "$got" "$command"
    failures=$((failures + 1))
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
    failures=$((failures + 1))
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
    failures=$((failures + 1))
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
    failures=$((failures + 1))
  fi
}

# 呼び出しとして切り出せない綴りは、最後の網で拾って deny 側へ落とす。
expect_mentions CATCH '$(which git) commit -m x'
expect_mentions CATCH 'x=git; $x commit -m y'
expect_mentions SKIP 'npm run commit-helper'
expect_mentions SKIP 'git log --oneline'
expect_mentions SKIP 'echo commit'

expect_dir() {
  local want=$1 command=$2 base=$3
  local got
  got=$(gate_target_dir "$command" "$base")
  if [ "$got" != "$want" ]; then
    printf 'FAIL  期待 %s / 実際 %s : %s\n' "${want:-（空）}" "${got:-（空）}" "$command"
    failures=$((failures + 1))
  fi
}

here=$(git rev-parse --show-toplevel)
other=$(git worktree list --porcelain | awk '/^worktree /{print $2}' | grep -v "^$here$" | head -1)

# 宛先が自明な形。起点の作業ディレクトリで commit が1つだけ走る。
expect_dir "$here" 'git commit -m x' "$here"
expect_dir "$here" 'git commit -m "fix: 直した"' "$here"
expect_dir "$here" 'git add -A && git commit -m x' "$here"
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
    failures=$((failures + 1))
  fi
}

# どのファイル種別でどの検証を選ぶか。
expect_kinds "ts" "src/app/App.tsx"
expect_kinds "ts" "src/shared/ui/Button.ts"
expect_kinds "ts" "src/index.scss"
expect_kinds "ts" "package.json"
expect_kinds "rust" "src-tauri/src/book/api.rs"
expect_kinds "rust" "src-tauri/Cargo.toml"
expect_kinds "rust" "src-tauri/tauri.conf.json"
expect_kinds "rust" "src-tauri/capabilities/default.json"
expect_kinds "rust" "rust-toolchain.toml"
expect_kinds "gate" ".claude/hooks/verify-gate.sh"
expect_kinds "" "README.md"
expect_kinds "" "docs/decisions/0002-drop-book-read-write.md"
expect_kinds "" ".claude/reviews/2026-08-30-book-foundation-r1.md"
# 引用符付きのパスは -z で読むので、ここへは素のまま来る
expect_kinds "ts" "src/dir with space/a.ts"

# 積んだ操作を畳む呼び出しは、検証の対象にしない。
#
# ここを塞ぐと、競合を抱えたツリー（＝検証が必ず落ちる状態）で競合を畳む手段が
# 無くなる。実際に行き止まりを踏んだのでテストで固定する。
expect_teardown() {
  local want=$1 command=$2
  local got=NO
  gate_is_teardown "$command" && got=YES
  if [ "$got" != "$want" ]; then
    printf 'FAIL  期待 %s / 実際 %s : %s\n' "$want" "$got" "$command"
    failures=$((failures + 1))
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

# --continue はコミットを作るので、免除しない
expect_teardown NO 'git rebase --continue'
expect_teardown NO 'git cherry-pick --continue'

# コミットを作る呼び出しを混ぜたものへ免除を広げない
expect_teardown NO 'git rebase --abort && git commit -m x'
expect_teardown NO 'git commit -m x && git rebase --abort'
expect_teardown NO 'git -C /tmp/other rebase --abort'
expect_teardown NO 'git commit --amend'

if [ "$failures" -eq 0 ]; then
  echo "verify-gate: 全て期待どおり"
  exit 0
fi

printf 'verify-gate: %d件が期待と違う\n' "$failures"
exit 1
