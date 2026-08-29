#!/usr/bin/env bash
# verify-gate.sh の判定部分を固定する。`bash .claude/hooks/verify-gate.test.sh` で走る。
#
# ゲートの正規表現は2ラウンド続けて素通しの穴を出した（`git -C <dir> commit` と
# `--git-dir <dir>` の空白区切り）。素通しは「検証されないまま通る」ので、
# 誤発火（余分に検証が走るだけ）より危険が大きい。ここで表にして固定する。

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

# `git -c` は `name=value` しか受けないので、空白区切りは git 自身が弾く。
# commit に到達しない以上、素通ししても検証されないコミットは生まれない。
expect_match SKIP 'git -c user.name a commit'

# commit ではないもの
expect_match SKIP 'git add -A'
expect_match SKIP 'git log --oneline'
expect_match SKIP 'npm run commit-helper'
expect_match SKIP 'echo commit'

expect_dir() {
  local want=$1 command=$2
  local got
  got=$(gate_target_dir "$command")
  if [ "$got" != "$want" ]; then
    printf 'FAIL  期待 %s / 実際 %s : %s\n' "$want" "$got" "$command"
    failures=$((failures + 1))
  fi
}

# ディレクトリを付け替えられたら、その先を検証すること
here=$(git rev-parse --show-toplevel)
expect_dir "$here" 'git commit -m x'
expect_dir "$here" "git -C $here commit -m x"
expect_dir "" 'git -C /nonexistent/not-a-repo commit -m x'

if [ "$failures" -eq 0 ]; then
  echo "verify-gate: 全て期待どおり"
  exit 0
fi

printf 'verify-gate: %d件が期待と違う\n' "$failures"
exit 1
