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
  got=$(jq -n '{tool_input: {command: "git commit -m x"}}' \
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

# **どの木を見るか。** ここを外すと、ワークツリーで作業している間じゅう
# 門番が主ワークツリー（clean なことが多い）を見て素通しする。
# 選び損ねても何も落ちないので、通した側は最後まで気付かない。
#
# 主ワークツリーは clean、ワークツリー側だけが `.ts` を持つ状態を作る。
# したがって **`run verify` が出れば木を正しく選べており、何も出なければ
# 主ワークツリーを見て素通しした**。木の名指しが解けなければ deny になる。
#
# コマンドは呼び手が組む。`%t` はワークツリー、`%r` は主ワークツリー、
# `%b` はワークツリーの basename（相対の名指しを試すため）に置き換える。
#
# 呼び出しの前に置く変数で状況を変える。
#   DIRTY=repo  変更を持つのを主ワークツリー側にする（既定はワークツリー側）
#   CWD=parent  コマンドが動く場所を両方の親にする（git 管理外）
#   SPACE=1     ワークツリーのパスに空白を入れる
#
# 期待値に `DENY` を渡すと、npm の呼び出しでなく deny が返ることを見る。
tree_case() {
  local label=$1 template=$2 want=$3
  local repo="$work/wt-repo" tree="$work/wt-tree"
  [ -n "${SPACE:-}" ] && tree="$work/wt tree"

  rm -rf "$repo" "$work/wt-tree" "$work/wt tree"
  mkdir -p "$repo"
  git -C "$repo" init -q -b main
  git -C "$repo" config user.email t@example.com
  git -C "$repo" config user.name t
  printf 'x\n' > "$repo/seed.md"
  git -C "$repo" add -A
  git -C "$repo" -c commit.gpgsign=false commit -qm seed

  git -C "$repo" worktree add -q -b side "$tree" >/dev/null 2>&1
  # **変更を持つのは片側だけ。** もう片方は clean なので、そちらを見た門番は
  # 検証を1つも走らせない——「どちらの木を見たか」が npm の呼び出しの有無で出る
  local dirty=$tree
  [ "${DIRTY:-tree}" = "repo" ] && dirty=$repo
  mkdir -p "$dirty/src"
  printf 'x\n' > "$dirty/src/a.ts"
  git -C "$dirty" add -A

  local cmd=$template
  cmd=${cmd//%r/$repo}
  cmd=${cmd//%b/$(basename "$tree")}
  cmd=${cmd//%t/$tree}

  local cwd=$repo
  [ "${CWD:-}" = "parent" ] && cwd=$work

  local log="$work/log"
  : > "$log"
  local got
  got=$(jq -n --arg cwd "$cwd" --arg cmd "$cmd" \
        '{cwd: $cwd, tool_input: {command: $cmd}}' \
    | PATH="$work/bin:$PATH" \
      CLAUDE_PROJECT_DIR="$repo" \
      VERIFY_GATE_TEST_LOG="$log" \
      bash "$hook" >"$work/out" 2>&1; sort -u "$log")

  local decision
  decision=$(jq -r '.hookSpecificOutput.permissionDecision // ""' < "$work/out" 2>/dev/null)
  if [ "$want" = "DENY" ]; then
    got=${decision:+DENY}
  elif [ -n "$decision" ]; then
    # **deny を「npm が呼ばれなかった」と混同しない。** 混同すると、
    # 素通しを期待したケースが deny でも緑になる——通したいものを止める side が
    # 検査から消える
    got="DENY（$(jq -r '.hookSpecificOutput.permissionDecisionReason' < "$work/out" 2>/dev/null | head -1)）"
  fi

  if [ "$got" = "$want" ]; then
    printf '  ok   %s\n' "$label"
  else
    printf '  NG   %s\n' "$label"
    printf '       期待: %s\n' "${want:-（呼ばれない）}"
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

# **種類で二分しない**——通す理由は「検査が読むから」で、置き場でも拡張子でもない。
# Rust 側が読むのは `docs/state-transitions/` だけ（`state_transition_cells` と
# `search_doc_names`）。ほかの `docs/` は vitest（識別子とパスの実在）が歩く
expect "状態遷移表は両方（表とソースを突き合わせるのは Rust 側）" \
  "docs/state-transitions/search.md" "$(printf 'run verify\nrun verify:rust')"

expect "ほかの docs は verify だけ（Rust 側に読み手がいない）" \
  "docs/decisions/a.md" "run verify"

expect "CONTRIBUTING.md も verify（ラチェットの索引と突き合わせる）" \
  "CONTRIBUTING.md" "run verify"

expect "SCSS も verify（寸法と対比のラチェットがある）" \
  "src/a.scss" "run verify"

expect ".claude/reviews/ は素通し" \
  ".claude/reviews/a.md" ""

expect "門番自身は verify（test:hooks がこの検査を走らせる）" \
  ".claude/hooks/verify-gate.sh" "run verify"

expect "門番の検査も verify" \
  ".claude/hooks/verify-gate.test.sh" "run verify"

# `kifuExtensions` が README の対応形式を実体と突き合わせ、`markdownLinks` が
# リンクを歩き、`rootDocuments` が直下の文書一覧を見る
expect "README も verify（対応形式とリンクを見る検査がある）" \
  "README.md" "run verify"

# **直下の文書は名前で数え上げない。** `rootDocuments` は直下に文書が
# 増えるのを止める検査なので、数え上げると**増やしたコミットでだけ走らない**
expect "CLAUDE.md も verify" \
  "CLAUDE.md" "run verify"

expect "直下の見知らぬ .md も verify（rootDocuments が止める側）" \
  "NOTES.md" "run verify"

# `capabilityPlugins`（TS）と `build.rs` の `tauri_build::build()`（cargo）が
# どちらも読む。cargo 側を外すと、壊したコミットの赤を次に `.rs` を触った人が踏む
expect "capabilities は verify:rust（cargo のビルド入力）" \
  "src-tauri/capabilities/default.json" "run verify:rust"

expect "tauri.conf.json も verify:rust（同上）" \
  "src-tauri/tauri.conf.json" "run verify:rust"

# **`.github/` を読む検査は両側に1つも無い。** 素通しでよい
expect "ワークフローはどちらも走らない（読む検査が無い）" \
  ".github/workflows/ci.yml" ""

expect "package.json は verify（Rust 側に読み手がいない）" \
  "package.json" "run verify"

# `tsshogiCsaPatterns`（TS、上流の版と突き合わせる）と `kifu_reader` の
# `tidy_csa`（Rust、整形してよい範囲）が同じ fixture を読む。
# 拡張子だけで振ると `.json` はどちらにも当たらず、作り直しただけのコミットで両方が黙る
expect "fixture は両方（TS と Rust が同じものを読む）" \
  "src-tauri/tests/fixtures/tsshogi_csa_patterns.json" \
  "$(printf 'run verify\nrun verify:rust')"

printf '\nどの木を見るか\n'

tree_case "cd の先を見る（cwd と CLAUDE_PROJECT_DIR より優先）" \
  'cd %t && git commit -m x' "run verify"

# **`git` と `commit` の間に `-` で始まらない語が入る形。**
# 文字列として `git…commit` の近さで判定すると、これらは**コミットと認識されず、
# 門番が起動しない**。この環境は絶対パスでの呼び出しを促すので、
# `git -C <ワークツリー> commit` は agent が自然に選ぶ綴りになる
tree_case "git -C <木> commit を取りこぼさない" \
  'git -C %t commit -m x' "run verify"

tree_case "git -c <k>=<v> ... commit を取りこぼさない" \
  'git -c user.name=x -C %t commit -m y' "run verify"

# 引用符の中は1つのトークン。メッセージに書いたパスを木として拾うと、
# コマンドが触るのとは別の木を検証して緑を出す
DIRTY=repo tree_case "コミットメッセージの中の cd を木として拾わない" \
  'git -C %r commit -m "docs: cd %t の話"' "run verify"

# **木が2つ以上あるとき、名指しの無いコミットは当てられない。**
# コミットが起きるのはシェルの cwd で、それはフックに届かない。
# 当てずっぽうで選ぶと、別の木が clean なら検証を1つも走らせずに素通しする
tree_case "木が複数あるのに名指しが無ければ deny" \
  'git commit -m x' "DENY"

# 空白を含むパス。語の切り方を空白に頼ると、途中で切れた断片で `git -C` を叩き、
# 失敗して**別の木へ落ちる**
SPACE=1 tree_case "空白を含むパスを cd で名指しできる" \
  'cd "%t" && git commit -m x' "run verify"

# 相対の名指しは**コマンドが動く場所**を基点に解く。フック自身の cwd で解くと、
# 同じ綴りが別の木を指す
CWD=parent tree_case "相対の cd は cwd を基点に解く" \
  'cd %b && git commit -m x' "run verify"

# 名指しがあって解けないときに、別の木へ落ちて緑を出さない
tree_case "解けない木を名指ししたら deny（別の木へ落ちない）" \
  'cd /nonexistent-tree-for-gate-test && git commit -m x' "DENY"

# **`cd` は commit の手前のものだけを採る。**
# 「最初の1つ」に決め打つと、コミットが起きるのとは別の木を検証する
tree_case "commit の手前の cd を採る（前に別の cd があっても）" \
  'cd %r && git status; cd %t && git commit -m x' "run verify"

# `cd` はシェルの中で累積するので、手前の最後の1つが commit 時の cwd
tree_case "手前に cd が並んだら最後のものを採る" \
  'cd %r && cd %t && git commit -m x' "run verify"

# commit より後ろの `cd` は、その commit とは関係が無い。
# 拾うと**シェルの cwd で起きるコミット**を別の木で検証する。
# 名指しが無いのと同じ扱いになるので、木が複数あれば deny
DIRTY=repo tree_case "commit より後ろの cd を木として拾わない" \
  'git commit -m x && cd %t' "DENY"

# **`-C` も commit に紐づける。** `status` や `add` の `-C` は木を言っていない。
# 「コマンド中の最初の `git -C`」で採ると、コミットが起きるのとは別の木を検証する
tree_case "git -C は commit のものだけを採る（status）" \
  'git -C %r status && git -C %t commit -m x' "run verify"

tree_case "git -C は commit のものだけを採る（add）" \
  'git -C %r add -A && git -C %t commit -m x' "run verify"

tree_case "git -C の非 commit と cd が混ざっても、cd を採る" \
  'git -C %r diff && cd %t && git commit -m x' "run verify"

# 同じ木を2回名指しする形は割れていない
tree_case "同じ木を add と commit で名指しするのは割れない" \
  'git -C %t add -A && git -C %t commit -m x' "run verify"

# コミットが2つあって名指しが食い違えば、どちらを検証すべきか決められない
tree_case "commit が複数で名指しが食い違えば deny" \
  'cd %r && git commit -m x && cd %t && git commit -m y' "DENY"

# **`git` は区切りの直後にしか立たない、ではない。**
# `then` や `time` の後ろでもコマンドとして走る。走査がコマンドの位置だけを見ると、
# これらは**コミットと認識されず、門番が起動しない**——素通しの側に倒れる。
# `-C` を使わない同じ形は deny になるので、取りこぼしは `-C` の側だけに出る
tree_case "then の後ろの git -C <木> commit" \
  'if true; then git -C %t commit -m x; fi' "run verify"

tree_case "do の後ろの git -C <木> commit" \
  'for f in a; do git -C %t commit -m x; done' "run verify"

tree_case "time の後ろの git -C <木> commit" \
  'time git -C %t commit -m x' "run verify"

tree_case "変数代入の後ろの git -C <木> commit" \
  'GIT_EDITOR=true git -C %t commit -m x' "run verify"

# 行継続は消える。1トークン残すと `commit` がサブコマンドの位置から外れる
tree_case "行継続を跨いだ commit" \
  'git -C %t \
  commit -m x' "run verify"

# **引用符は改行を跨ぐ。** 行ごとに状態を捨てると、本文の2行目以降が
# コマンドとしてトークン化され、行頭の `git commit` が2つ目のコミットに見える。
# この repo のコミットは本文を持つのが常態なので、門番の話を書いた瞬間に当たる
tree_case "本文が git commit で始まる複数行のメッセージ" \
  'git -C %t commit -m "fix: 門番

git commit を横取りする"' "run verify"

# ヒアドキュメントの本文はデータ。コマンドとして読むと同じ誤検知になる
tree_case "ヒアドキュメントの中の git commit" \
  "git -C %t commit -F - <<'EOF'
docs: 門番

git commit の話
EOF" "run verify"

# 改行もコマンドの区切り。跨いで1トークンにすると、2行目の `git` が語の中に埋まって
# コミットと認識されなくなる
tree_case "改行で区切った2つのコマンド" \
  'git -C %t add -A
git -C %t commit -m x' "run verify"

# **手前の行で引用符の状態を壊さない。** 壊すと、そこから先の全文が1トークンに
# 飲まれてコミットが見えなくなり、木の名指しも消える——**名指ししてあるのに
# 「木が読めない」と言って止める**。案内どおりに直しても通らない形になる
tree_case "手前の行にエスケープした引用符がある" \
  'echo "say \"hi\"" > /dev/null
git -C %t commit -m y' "run verify"

tree_case "手前の行にアポストロフィを含むコメントがある" \
  "# don'\''t touch
git -C %t commit -m x" "run verify"

# ヒアドキュメントの終端は行全体の一致で見るが、末尾の空白で解除に失敗すると
# 以降が全部本文として捨てられる
tree_case "ヒアドキュメントの終端の後ろに空白がある" \
  "cat > /dev/null <<'MSG'
fix: x
MSG 
git -C %t commit -m y" "run verify"

# **コミットしないコマンドを止めない。** 門番自身を直すときは
# `git commit` を含む文字列を grep することになる。
# 保険の grep の手前を緩めたぶん、ここで締めていないと検索が deny される
# **正の綴りでなければ、コミットでなくても止める。**
# 引用符の中の `git commit` が実行されるのか文字列なのかは読み取れない。
# 綴りを1つ塞ぐたびに別の綴りが開く形（通算7回、いずれも検証0件で通った）を
# 終わらせるために、開いた文法を追うのをやめて閉じた側に倒してある
tree_case "git commit を含む文字列の検索も止める" \
  'rg "git commit " %t' "DENY"

# **走査器が「コマンドではない」と決めた領域を読み戻さない。**
# 生の文字列を読み戻すと、シェルのコメント・ヒアドキュメントの本文・
# 素の日本語まで deny される
tree_case "シェルのコメントの中の git commit" \
  'jq -n "{a:1}" # git commit' ""

tree_case "ヒアドキュメントの本文の git commit" \
  "cat > /dev/null <<'EOF'
git commit の作法
EOF" ""

# **引用符の中は区別できない。** `bash -c "git … commit"` と同じ形なので、
# 閉じた文法では止まる側に倒す。崩した綴りで書くこと
tree_case "引用符の中に両方の語がある形は止める" \
  'echo "git の commit を調べる"' "DENY"

tree_case "git log --grep commit" \
  'git -C %t log --grep commit' ""

tree_case "綴りを崩せば素通し" \
  'rg "git commi[t] " %t' ""

# **前置語を数え上げない。** 透過語の一覧で受ける形にすると、載っていない語
# （`timeout` / `sudo` / `stdbuf` / `caffeinate` …）が付いた commit が
# **検証を1つも走らせずに通る**。トークンが厳密に `git` なら、
# コマンドの位置に立っているかを問わずに commit として扱う
tree_case "timeout を挟んだ commit" \
  'timeout 60 git -C %t commit -m x' "run verify"

tree_case "sudo を挟んだ commit" \
  'sudo -n git -C %t commit -m x' "run verify"

tree_case "stdbuf を挟んだ commit" \
  'stdbuf -oL git -C %t commit -m x' "run verify"

# **`${#…}` はコメントではない。** `{` を区切りにしているので `#` が
# コマンドの位置に立つ。行末まで飛ばすと同じ行の commit が消える
tree_case "展開の # を含む行の commit" \
  'echo ${#PATH}; git -C %t commit -m x' "run verify"

# 絶対パスのシェルも「シェルを起こす綴り」。手前の1文字に `/` を許さないと
# 一覧に当たらず、引用符の中の commit が素通しする
tree_case "絶対パスのシェルに隠した commit" \
  'bash -c "git -C %t commit -m x"' "DENY"

tree_case "/bin/bash に隠した commit" \
  '/bin/bash -c "git -C %t commit -m x"' "DENY"

# **保険の grep も `-C` の引数を跨げること。** トークン走査から隠れる形
# （引用符の中へ丸ごと入れる）で、走査を入れた理由そのものの綴りを渡す。
# 保険が拾えないと**検証を1つも走らせずに素通しする**——2つの経路が
# 同じ死角を共有していないことを、ここだけが見ている。
# 木は名指しできない（引用符の中なので）ので、木が複数あれば deny になる
tree_case "引用符に隠した git -C <木> commit" \
  'bash -c "git -C %t commit -m x"' "DENY"

# **後ろに語が無い形も止める。** `commit` の直後に空白か行末を要求すると、
# 引用符で閉じる形だけが判定から外れる
tree_case "引用符の末尾で終わる commit" \
  'bash -c "git -C %t commit"' "DENY"

# 絶対パスで綴った git も、basename で拾う
tree_case "/usr/bin/git -C <木> commit" \
  '/usr/bin/git -C %t commit -m x' "run verify"

# 引用符に隠れた側も同じ。手前の1文字に `/` を許さないと、この形だけが素通しする
tree_case "引用符に隠した絶対パスの git" \
  'bash -c "/usr/bin/git -C %t commit -m x"' "DENY"

printf '\n'
if [ "$failures" -eq 0 ]; then
  printf '全部通った\n'
else
  printf '%d 件落ちた\n' "$failures"
  exit 1
fi
