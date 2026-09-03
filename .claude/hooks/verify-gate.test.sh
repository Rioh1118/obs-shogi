#!/usr/bin/env bash
# `verify-gate.sh` がどの verify を選ぶかを固定する。
#
# **選び損ねても何も落ちないのが、この門番の一番危ない壊れ方。**
# 通したいものを通さないほうは、書いた人がすぐ気付く。通してはいけないものを
# 通すほうは、次に別のファイルを触った人が身に覚えのない赤を踏むまで誰も気付かない。
#
# 本物のフックを本物の git リポジトリに対して走らせる。`npm` は PATH の先頭に
# 置いたスタブで受けて、呼ばれた引数だけを記録する（フック側に検査を飛ばす口を
# 作らないため。作った時点で門番ではなくなる）。
#
# 走らせ方: bash .claude/hooks/verify-gate.test.sh

set -uo pipefail

hook=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/verify-gate.sh
[ -f "$hook" ] || { echo "フックが見つからない: $hook"; exit 1; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# `npm` のスタブ。呼ばれた引数を1行ずつ書き出して成功で返る
mkdir -p "$work/bin"
cat > "$work/bin/npm" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$VERIFY_GATE_TEST_LOG"
exit 0
STUB
chmod +x "$work/bin/npm"

failures=0

# 使い方: expect "<説明>" "<作るファイル>" "<期待する npm の呼び出し（改行区切り、空なら呼ばれない）>"
expect() {
  local label=$1 file=$2 want=$3
  local repo="$work/repo"

  rm -rf "$repo"
  mkdir -p "$repo"
  git -C "$repo" init -q
  git -C "$repo" config user.email t@example.com
  git -C "$repo" config user.name t

  mkdir -p "$repo/$(dirname "$file")"
  printf 'x\n' > "$repo/$file"
  git -C "$repo" add -A

  local log="$work/log"
  : > "$log"

  local got
  got=$(printf '{"tool_input":{"command":"git commit -m x"}}' \
    | PATH="$work/bin:$PATH" \
      CLAUDE_PROJECT_DIR="$repo" \
      VERIFY_GATE_TEST_LOG="$log" \
      bash "$hook" >/dev/null 2>&1; sort -u "$log")

  local expected
  expected=$(printf '%s' "$want" | sed '/^$/d' | sort -u)

  if [ "$got" = "$expected" ]; then
    printf '  ok   %s\n' "$label"
  else
    printf '  NG   %s\n' "$label"
    printf '       期待: %s\n' "${expected:-（呼ばれない）}"
    printf '       実際: %s\n' "${got:-（呼ばれない）}"
    failures=$((failures + 1))
  fi
}

printf 'verify-gate.sh がどの verify を選ぶか\n'

expect "TS を触ったら verify" \
  "src/a.ts" "run verify"

expect "Rust を触ったら両方（TS 側のラチェットが src-tauri を歩く）" \
  "src-tauri/src/a.rs" "$(printf 'run verify\nrun verify:rust')"

expect "Cargo.toml も両方" \
  "src-tauri/Cargo.toml" "$(printf 'run verify\nrun verify:rust')"

expect "状態遷移表は両方（表とテストの名乗りを突き合わせるのは Rust 側）" \
  "docs/state-transitions/a.md" "$(printf 'run verify\nrun verify:rust')"

expect "その他の docs は verify だけ" \
  "docs/decisions/a.md" "run verify"

expect "CONTRIBUTING.md も verify（ラチェットの索引と突き合わせる）" \
  "CONTRIBUTING.md" "run verify"

expect "SCSS も verify（寸法と対比のラチェットがある）" \
  "src/a.scss" "run verify"

expect ".claude/ だけなら素通し" \
  ".claude/reviews/a.md" ""

expect "README だけなら素通し" \
  "README.md" ""

printf '\n'
if [ "$failures" -eq 0 ]; then
  printf '全部通った\n'
else
  printf '%d 件落ちた\n' "$failures"
  exit 1
fi
