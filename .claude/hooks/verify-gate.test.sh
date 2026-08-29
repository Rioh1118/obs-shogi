#!/usr/bin/env bash
# verify-gate.sh の判定部分を固定する。`bash .claude/hooks/verify-gate.test.sh` で走る。
#
# 素通し（検証されないまま通る）は、誤発火（余分に検証が走るだけ）より危険が
# 大きい。素通しになる綴りを表にして固定する。

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

# 素通ししてはいけないもの
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

# `-c` の次のトークンが設定名として消費されるので、`a` がサブコマンドになり
# commit へ到達しない。素通ししても検証されないコミットは生まれない。
expect_match SKIP 'git -c user.name a commit'

# commit ではないもの
expect_match SKIP 'git add -A'
expect_match SKIP 'git log --oneline'
expect_match SKIP 'npm run commit-helper'
expect_match SKIP 'echo commit'

expect_dir() {
  local want=$1 command=$2 base=$3
  local got
  got=$(gate_target_dir "$command" "$base")
  if [ "$got" != "$want" ]; then
    printf 'FAIL  期待 %s / 実際 %s : %s\n' "$want" "$got" "$command"
    failures=$((failures + 1))
  fi
}

# 検証するのは、コミットされるツリー。
here=$(git rev-parse --show-toplevel)
other=$(git worktree list --porcelain | awk '/^worktree /{print $2}' | grep -v "^$here$" | head -1)

expect_dir "$here" 'git commit -m x' "$here"
expect_dir "$here" "git -C $here commit -m x" /
expect_dir "$here" "tar -C /tmp x && git commit -m x" "$here"
expect_dir "$here" "grep -C 3 foo f.txt && git commit -m x" "$here"
expect_dir "$here" "git commit -m x && git -C /tmp log" "$here"
expect_dir "" 'git -C /nonexistent/not-a-repo commit -m x' "$here"
# --git-dir だけでは作業ツリーを一意に決められないので deny 側へ落とす
expect_dir "" 'git --git-dir=/tmp/x/.git commit -m x' "$here"

# cd で移った先がコミットされるツリー。Bash の作業ディレクトリは呼び出しを
# 跨いで持続するので、起点は payload の cwd から渡す。
if [ -n "$other" ]; then
  expect_dir "$other" "cd $other && git commit -m x" "$here"
  expect_dir "$other" "cd $other; git commit -m x" "$here"
  expect_dir "$here" "cd $other && git -C $here commit -m x" "$here"
  expect_dir "$other" 'git commit -m x' "$other"
  expect_dir "$other" "cd '$other' && git commit -m x" "$here"
  expect_dir "$other" "cd \"$other\" && git commit -m x" "$here"
  expect_dir "$other" "(cd $other && git commit -m x)" "$here"
  expect_dir "$other" "pushd $other && git commit -m x" "$here"

  # 解釈できない綴りは、素通しさせずに deny 側へ落とす
  expect_dir "" "env -C $other git commit -m x" "$here"
  expect_dir "" 'cd $TARGET && git commit -m x' "$here"
  expect_dir "" 'cd ~/obs-shogi && git commit -m x' "$here"
  expect_dir "" "sh -c 'cd $other && git commit -m x'" "$here"
  expect_dir "" "cd $here && git commit -m a && cd $other && git commit -m b" "$here"
else
  echo "SKIP  比較用のワークツリーが無いので cd 系のケースは走らせていない"
fi

if [ "$failures" -eq 0 ]; then
  echo "verify-gate: 全て期待どおり"
  exit 0
fi

printf 'verify-gate: %d件が期待と違う\n' "$failures"
exit 1
