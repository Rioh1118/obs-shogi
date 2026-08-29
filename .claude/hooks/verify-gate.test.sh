#!/usr/bin/env bash
# verify-gate.sh の判定部分を固定する。`bash .claude/hooks/verify-gate.test.sh` で走る。
#
# 素通し（検証されないまま通る）は、誤発火（余分に検証が走るだけ）より危険が
# 大きい。素通しになる綴りを表にして固定する。
#
# 表は2つ。
#   gate_matches_commit — コミットを作る呼び出しを見落とさないこと
#   gate_target_dir     — 宛先が自明でない綴りは空（deny）にすること

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
expect_match CATCH 'git merge --abort'

# commit ではないもの
expect_match SKIP 'git add -A'
expect_match SKIP 'git log --oneline'
expect_match SKIP 'npm run commit-helper'
expect_match SKIP 'echo commit'

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
# メッセージ本文に git commit と書いただけで「呼び出しが2つ」と数えないこと。
# ゲートの説明を書いたコミットほど止まる形になる。
expect_dir "$here" 'git commit -m "fix: git commit の検出を直す"' "$here"
expect_dir "$here" "git commit -m 'docs: git rebase の話'" "$here"
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
expect_dir "" "GIT_DIR=$target/.git GIT_WORK_TREE=$target git commit -m x" "$here"
expect_dir "" "GIT_INDEX_FILE=/tmp/i git commit -m x" "$here"
expect_dir "" 'nohup git commit -m x' "$here"
expect_dir "" 'ssh host git commit -m x' "$here"
expect_dir "" 'npm run build && git commit -m x' "$here"
expect_dir "" 'git commit -m x' /nonexistent/not-a-repo

if [ "$failures" -eq 0 ]; then
  echo "verify-gate: 全て期待どおり"
  exit 0
fi

printf 'verify-gate: %d件が期待と違う\n' "$failures"
exit 1
