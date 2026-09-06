#!/usr/bin/env bash
# PreToolUse(Bash) ゲート: 検証を通していない `git commit` を止める。
#
# 選ぶ基準は**ファイルの種類ではなく、検査が何を見ているか**。
#
#   npm run verify:rust  ... cargo が見るもの。**`.rs` と `Cargo.*` だけではない**
#                            ——`src-tauri/tests` の検査は `docs/state-transitions/` を
#                            直に読む
#   npm run verify       ... tsc と lint と vitest が見るもの。
#                            **`src/__tests__` の検査のいくつかは
#                            `src-tauri/src` と `docs/` を直に読む。**
#                            どちらも列挙しない（数え上げると必ず1つ漏れる）。
#                            一覧が要るなら CONTRIBUTING.md の表を見ること
#
# **種類で二分しない。** 二分すると、`.rs` だけのコミットで Rust のコメント規約が
# 走らず、`docs/` だけのコミットで表の識別子とパスが誰にも見られない。
# 落ちるのは次に `.ts` を1文字触った人で、その人は自分が書いていない赤を踏む。
#
# どの検査にも当たらない変更は素通しする。`.claude/` は**一括では素通しできない**
# ——`.claude/hooks/` はこのファイル自身とその検査（`npm run test:hooks`）を
# 持つので、そこを触ったら `npm run verify` を通す。
#
# 落ちたら permissionDecision: deny を返してコミット自体を止める。
# 逃げ道は用意しない。逃げ道を用意した時点でゲートではなくなる。
#
# **`git` と `commit` は引用符の外に、別々の語として置くこと。**
# それ以外の形で `git` と `commit` が語として現れたら、
# コミットかどうかに関わらず断る（実行されるのか文字列なのかを読み取れない）。
# `git` の手前に何が付いていても（`timeout` など）、絶対パスで綴っても構わない。
#
# **木が2つ以上あるなら名指しが要る。** 名指しは `git -C <木>` か `cd <木>`
# （相対はコマンドの cwd を基点に解く）。木が1つしか無いリポジトリでは
# 曖昧さが無いので、名指しは要らない。
#
# 案内する綴りは deny の文面が持つ——ここに2つ目の版を置かない。
#
# **開いた文法を追いかけない。** `git -C` を拾えば前置語が漏れ、前置語を拾えば
# 絶対パスが漏れ、そこを拾えば `commit` の直後が漏れる。**漏れた形は
# 検証を1つも走らせずに通る。** 数え上げをやめて閉じた側に倒す。

set -uo pipefail

payload=$(cat)
command=$(printf '%s' "$payload" | jq -r '.tool_input.command // ""')

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

# **コマンドは文字列でなくトークンとして読む。**
#
# 文字列のまま `git` と `commit` の近さで判定すると、間に `-` で始まらない語が入る形
# （`git -C <木> commit`、`git -c user.name=x commit`）を**コミットと認識できない**。
# 認識しなければ門番は起動せず、検証を1つも走らせずに通る。この環境は絶対パスでの
# 呼び出しを促すので、`git -C <ワークツリー> commit` は自然に選ばれる綴りになる。
#
# 同じ理由で、木の名指しも引用符を跨いで拾ってはいけない。`-m "… cd /path …"` の
# メッセージは1つのトークンなので、ここから `cd` の先を拾うことはない。
#
# 出す値は4行。コミットか否か、**コマンドが名指しした木**
# （`git -C` を優先し、無ければコマンドの位置に置かれた `cd` の先）、
# コミットが複数あって名指しが割れたか、**`git` と `commit` が語として見えたか**。
#
# 4行目は保険の入力。コミットと読み取れなかったとき、この値が真なら
# 「読み取れない綴り」として断る。**行を増やすときは末尾に足すこと**
# ——順を動かすと保険の入力が空になり、素通しに倒れる。
gate_scan_awk=$(cat <<'AWK'
function emit(t, s) { n++; tok[n] = t; st[n] = s }

# **ヒアドキュメントの本文はコマンドではなくデータ。**
# トークンに入れると、本文の中の `git commit` が偽のコミットになる
# （`git commit -F - <<'EOF' … EOF` でコミットの作法を説明する形で当たる）。
#
# 見るのは `<<` に隙間なく続く綴りだけ。`<< EOF` の形は稀で、
# 空けた `<<` を拾いにいくと `-m "a << b"` のメッセージを本文の始まりと
# 読んでしまう——**取りこぼす側に倒す**（拾えなければ下の保険が受ける）。
hd != "" {
  line = $0
  sub(/^[ \t]+/, "", line)
  sub(/[ \t]+$/, "", line)
  if (line == hd) hd = ""
  next
}
{
  if (match($0, /<<-?['"]?[A-Za-z_][A-Za-z0-9_]*/)) {
    hd = substr($0, RSTART, RLENGTH)
    sub(/^<<-?['"]?/, "", hd)
  }
  # **1行ずつ読み直さない。** 引用符は改行を跨ぐので、行ごとに状態を捨てると
  # 複数行のコミットメッセージの2行目以降が**コマンドとして**トークン化される。
  # 本文が `git commit` で始まる commit を書いた人が、偽の理由で止められる
  src = src $0 "\n"
}
END {
  n = 0; atstart = 1; buf = ""; have = 0; curstart = 1
  L = length(src); i = 1
  while (i <= L) {
    c = substr(src, i, 1)
    if (c == " " || c == "\t") {
      if (have) { emit(buf, curstart); buf = ""; have = 0; atstart = 0 }
      i++; continue
    }
    # コマンドの区切り。ここを跨いだ次の語は「コマンドの位置」に立つ
    if (c == ";" || c == "&" || c == "|" || c == "(" || c == ")" || c == "{" || c == "}" || c == "\n") {
      if (have) { emit(buf, curstart); buf = ""; have = 0 }
      atstart = 1; i++; continue
    }
    # **シェルのコメント。** 知らないと `# don't touch` の `'` が引用符を開き、
    # そこから先の全文が1トークンに飲まれる——**手前の行のコメント1つで、
    # 名指ししてある正当なコミットが「木が読めない」と言って止まる**。
    #
    # `${#PATH}` の `#` は展開であってコメントではない。`{` を区切りにしている
    # ので直前の1文字で見分ける——見分けないと、同じ行の commit が消える
    if (c == "#" && !have && substr(src, i - 1, 1) != "{") {
      while (i <= L && substr(src, i, 1) != "\n") i++
      continue
    }
    if (c == "'" || c == "\"") {
      if (!have) curstart = atstart
      q = c; i++
      while (i <= L) {
        d = substr(src, i, 1); i++
        # `"` の中では `\` が次の1文字を逃がす。`'` の中では逃がさない
        if (d == "\\" && q == "\"" && i <= L) { buf = buf substr(src, i, 1); i++; continue }
        if (d == q) break
        buf = buf d
      }
      have = 1; continue
    }
    if (c == "\\") {
      # 行継続。何も残さずに消える——1トークン残すと `git -C <木> \` の次行の
      # `commit` がサブコマンドの位置から外れ、コミットと認識できなくなる
      if (i < L && substr(src, i + 1, 1) == "\n") { i += 2; continue }
      if (!have) curstart = atstart
      i++
      if (i <= L) { buf = buf substr(src, i, 1); i++ }
      have = 1; continue
    }
    if (!have) curstart = atstart
    buf = buf c; have = 1; i++
  }
  if (have) emit(buf, curstart)

  # **語を挟んでもコマンドの位置は失われない。**
  # `then` や `time` の後ろの `git` は、区切りの直後と同じくコマンドとして走る。
  # ここを見落とすと `if true; then git -C <木> commit; fi` が門番を起動させない。
  for (k = 1; k <= n; k++) {
    if (!st[k]) continue
    if (tok[k] == "then" || tok[k] == "else" || tok[k] == "elif" || tok[k] == "do" \
        || tok[k] == "!" || tok[k] == "time" || tok[k] == "env" || tok[k] == "nice" \
        || tok[k] == "nohup" || tok[k] == "command" || tok[k] == "exec" \
        || tok[k] == "eval" || tok[k] ~ /^[A-Za-z_][A-Za-z0-9_]*=/) {
      if (k < n) st[k + 1] = 1
    }
  }

  # **木の名指しは commit に紐づける。** 綴りは2つある——`git -C <木>` と `cd <木>`。
  #
  # どちらも「コマンド中の最初の1つ」で採ってはいけない。
  # `git -C A status && git -C B commit` の A も、`cd A && git status; cd B && git commit` の A も、
  # **コミットが起きるのとは別の木**。そこを検証すると、A が clean なら検証0件で素通しする。
  #
  # `-C` はその `git` 呼び出しのもの、`cd` は commit の手前の最後の1つ（シェルの中で累積する）。
  # commit より後ろの `cd` は採らない——その commit はシェルの cwd で起きるので、
  # 名指しが無いのと同じ扱いになる。
  #
  # commit が2つ以上あって名指しが割れるときは決められないので、印を立てて呼び出し側に deny させる。
  for (k = 1; k <= n; k++) {
    # 引用符の中に隠れた綴りも、トークンとしては1語で見える
    if (tok[k] ~ /(^|[^A-Za-z0-9_.-])(\/[^ ]*\/)?git([ ]|$)/) sawgit = 1
    # **オプションの引数はサブコマンドになりえない。** `--grep commit` の
    # `commit` を数えると、コミットでない `git log` が断られる。
    #
    # 除くのは**裸の1語**だけ。`bash -c "git … commit"` の引用符の塊は
    # `-c` の引数だが、中身は実行されうるので数える
    if (tok[k] ~ /(^|[^A-Za-z0-9_=-])commit([^A-Za-z0-9_-]|$)/) {
      if (!(k > 1 && substr(tok[k - 1], 1, 1) == "-" && tok[k] !~ / /)) sawcommit = 1
    }
    if (st[k] && tok[k] == "cd" && k < n) pending = tok[k + 1]
    # **`git` にコマンドの位置も厳密一致も要求しない。**
    # 位置を要求すると前置語（`timeout` / `sudo` / `stdbuf` …）を、
    # 厳密一致を要求すると綴り（`/usr/bin/git` / `./git`）を数え上げることになり、
    # **どちらも必ず1つ漏れて検証0件で通る**。見るのは basename だけ
    if (tok[k] == "git" || tok[k] ~ /\/git$/) {
      j = k + 1
      here = ""
      while (j <= n) {
        # 引数を1つ取る git のオプション。読み飛ばさないと、その引数を
        # サブコマンドと取り違える
        if (tok[j] == "-C") { if (j < n) here = tok[j + 1]; j += 2; continue }
        if (tok[j] == "-c" || tok[j] == "--git-dir" || tok[j] == "--work-tree" \
            || tok[j] == "--namespace" || tok[j] == "--exec-path") { j += 2; continue }
        if (substr(tok[j], 1, 1) == "-") { j++; continue }
        break
      }
      # **語として見えたことを覚える。** 保険はこれを見る——生の文字列を
      # 読み戻すと、走査器が「コマンドではない」と決めた領域
      # （シェルのコメント、ヒアドキュメントの本文）まで拾ってしまう
      sawgit = 1
      # **`commit` だったときにだけ採る。** `status` や `add` の `-C` は木を言っていない
      if (j <= n && tok[j] == "commit") {
        named = (here != "" ? here : pending)
        if (iscommit && named != chosen) mixed = 1
        chosen = named
        iscommit = 1
      }
    }
  }

  print (iscommit ? 1 : 0)
  print chosen
  print (mixed ? 1 : 0)
  print ((sawgit && sawcommit) ? 1 : 0)
}
AWK
)

gate_scan=$(printf '%s' "$command" | awk "$gate_scan_awk")
is_commit=$(printf '%s\n' "$gate_scan" | sed -n '1p')
named_tree=$(printf '%s\n' "$gate_scan" | sed -n '2p')
trees_split=$(printf '%s\n' "$gate_scan" | sed -n '3p')
saw_both_words=$(printf '%s\n' "$gate_scan" | sed -n '4p')

# **正の綴りは2つだけ。それ以外で `git` と `commit` が語として現れたら止める。**
#
# ここまでの走査が拾うのは `<basename が git> [オプション] commit` の形だけ。
# 拾えなかったのに両方の語がトークンとして見えるなら、**引用符の中に隠れた
# 実行か、走査が知らない綴り**のどちらかで、区別する術は無い。
#
# **開いた文法を追いかけない。** `git -C` → 前置語 → 絶対パス → `commit` の直後、と
# 綴りを1つ塞ぐたびに別の綴りが開き、そのたびに**検証を1つも走らせずに通った**。
# 数え上げをやめて、正の綴り以外を全部断る側に倒す——このファイルの冒頭が
# 決めているとおり、通してはいけないものを通すより、通したいものを一度止めるほうが安い。
#
# **見るのはトークンだけ。** 生の文字列を読み戻すと、走査器が「コマンドでは
# ない」と決めた領域——シェルのコメント、ヒアドキュメントの本文——まで拾い、
# コミットメッセージの下書きや素の日本語が deny される。
#
# 代償: `rg "git commit"` のような検索も止まる（引用符の中は1トークンとして
# 残るため）。`commi[t]` と綴りを崩すこと。
if [ "$is_commit" != "1" ]; then
  [ "${saw_both_words:-0}" = "1" ] || exit 0
  deny "検証ゲート: コミットの綴りを読み取れない。

**通る綴りは2つだけ。** どちらも木を絶対パスで名指しする。

  git -C <ワークツリーの絶対パス> commit -m \"...\"
  cd <ワークツリーの絶対パス> && git commit -m \"...\"

`git` の手前に何が付いていても（\`timeout\` など）、絶対パスで書いても構わないが、
**\`git\` と \`commit\` は引用符の外に、別々の語として置くこと**。

引用符の中やヒアドキュメントに入れた形は、実行されるのか文字列なのかを
読み取れないので断っている。\`git commit\` を含む文字列を検索したいだけなら、
\`commi[t]\` のように綴りを崩すこと。

コミットは実行していない。"
fi

# **どの木を見るかを間違えない。** `CLAUDE_PROJECT_DIR` はセッションを開いた場所を
# 指すので、ワークツリー（`.claude/worktrees/*`）で作業していると、そこを見ずに
# 主ワークツリーを検証する。主ワークツリーが clean なら**検証を1つも走らせずに
# 素通しし**、別のブランチで赤ければ**こちらが緑でも止まる**。
# どちらの向きにも、見ている木が違うことは出力に出ない。
command_cwd=$(printf '%s' "$payload" | jq -r '.cwd // ""')

project_dir=""
# コミットが複数あって名指しが割れている。どれを検証すればよいか決められない
[ "${trees_split:-0}" = "1" ] && deny "検証ゲート: コミットが複数あり、名指しした木が食い違っている。

どちらの木を検証すればよいか決められない。当てずっぽうで選ぶと、
**別の木を検証して緑を出す**（そちらが clean なら検証は1つも走らない）。

1つのコマンドで1つの木にコミットすること。

コミットは実行していない。"

if [ -n "$named_tree" ]; then
  case "$named_tree" in
    /*) candidate=$named_tree ;;
    "~") candidate=$HOME ;;
    "~"/*) candidate="$HOME${named_tree#\~}" ;;
    # 相対の名指しは**コマンドが動く場所**を基点に解く。フック自身の cwd で
    # 解くと、同じ綴りが別の木を指す
    *) candidate="${command_cwd:-.}/$named_tree" ;;
  esac
  project_dir=$(git -C "$candidate" rev-parse --show-toplevel 2>/dev/null)
  # **名指しがあって解けなかったら諦めない。** ここで別の木へ落ちると、
  # コマンドが触る木とは違う木を検証して緑を出す
  [ -n "$project_dir" ] || deny "検証ゲート: コマンドが名指しした木を解決できない: ${named_tree}

どの木を検証すればよいか決められないので、コミットは実行していない。
ワークツリーで作業するなら \`cd <絶対パス> && git ...\` か \`git -C <絶対パス> ...\` と書くこと。"
fi

if [ -z "$project_dir" ] && [ -n "$command_cwd" ]; then
  project_dir=$(git -C "$command_cwd" rev-parse --show-toplevel 2>/dev/null)
fi
if [ -z "$project_dir" ] && [ -n "${CLAUDE_PROJECT_DIR:-}" ]; then
  project_dir=$(git -C "$CLAUDE_PROJECT_DIR" rev-parse --show-toplevel 2>/dev/null)
fi

# **木が2つ以上あるなら、名指しを要る。**
#
# 名指しが無いとき、コミットが起きるのは**シェルの cwd**。フックに届く `cwd` は
# セッションを開いた場所で、シェルの `cd` は映らないので、木が複数あれば
# ここで当てることは原理的にできない。当て損ねた結果は両向きとも黙っている
# ——別の木が clean なら検証を1つも走らせずに素通しし、そちらが赤ければ
# こちらが緑でも止まる。**当て損ねは両向きとも黙る。**
#
# 木が1つしか無いなら曖昧さが無いので、名指しは要らない。
if [ -z "$named_tree" ] && [ -n "$project_dir" ]; then
  trees=$(git -C "$project_dir" worktree list 2>/dev/null | wc -l | tr -d ' ')
  if [ "${trees:-1}" -gt 1 ]; then
    deny "検証ゲート: どの木でコミットするのかがコマンドから読めない。

このリポジトリには木が ${trees} つある（\`git worktree list\`）。名指しが無いと
コミットが起きるのはシェルの cwd だが、それはフックに届かない。当てずっぽうで
選ぶと、**別の木を検証して緑を出す**（そちらが clean なら検証は1つも走らない）。

木を名指しして書き直すこと:

    git -C <絶対パス> commit -m ...
    cd <絶対パス> && git commit -m ...

コミットは実行していない。"
  fi
fi
[ -n "$project_dir" ] || project_dir=$(git rev-parse --show-toplevel 2>/dev/null)
[ -n "$project_dir" ] || deny "検証ゲート: git リポジトリを見つけられない。

コミットは実行していない。"
cd "$project_dir" || deny "検証ゲート: ${project_dir} へ移れない。

コミットは実行していない。"

# ステージ済みと作業ツリーの両方を見る（`git commit -a` を取りこぼさないため）。
# リネーム行 "R  old -> new" は新しい方だけを見れば足りる。
needs_ts=0
needs_rust=0
while IFS= read -r line; do
  path=${line:3}
  path=${path##* -> }
  # `npm run verify:rust` の対象。**状態遷移表もここに入る。**
  # `state_transition_cells` と `search_doc_names` が表とソースを突き合わせていて、
  # **それが壊れる改変は表だけを触るコミットで来る**
  case "$path" in
    *.rs|*Cargo.toml|*Cargo.lock) needs_rust=1 ;;
    docs/state-transitions/*) needs_rust=1 ;;
    # **cargo のビルド入力**（`build.rs` の `tauri_build::build()` が読む）。
    # 壊すとビルドスクリプトで落ちるので、外すと**次に `.rs` を触った人**が
    # 身に覚えのない赤を踏む
    src-tauri/capabilities/*|src-tauri/tauri.conf.json) needs_rust=1 ;;
    # `kifu_reader` の `tidy_csa` が読む。拡張子だけで振ると `.json` の
    # fixture はどちらにも当たらず、**作り直しただけのコミットで両方が黙る**
    src-tauri/tests/fixtures/*) needs_rust=1 ;;
  esac
  # `npm run verify` の対象。**`.rs` と `docs/` もここに入る。**
  # vitest のラチェットが `src-tauri/**` と `docs/**` を歩いているので、
  # そこを触ったコミットで走らせないと検査が素通りする。
  # `Cargo.*` を歩く vitest は無いが、`.rs` と同じ腕に置いて場合分けを増やさない
  case "$path" in
    *.ts|*.tsx|tsconfig*.json|vite.config.ts|package.json|package-lock.json) needs_ts=1 ;;
    *.rs|*Cargo.toml|*Cargo.lock) needs_ts=1 ;;
    docs/*) needs_ts=1 ;;
    *.scss) needs_ts=1 ;;
    # `tsshogiCsaPatterns` が上流の版と突き合わせる（Rust 側と同じ fixture）
    src-tauri/tests/fixtures/*) needs_ts=1 ;;
    # **門番自身とその検査。** `npm run verify` は `test:hooks` を含むので、
    # ここを外すと**門番を書き換えるコミットでその検査が1度も走らない**
    # ——選び損ねても何も落ちない、というこの門番の一番危ない壊れ方が、
    # 門番自身の変更に対してだけ成立する
    .claude/hooks/*) needs_ts=1 ;;
  esac
  # **直下の文書は名前を数え上げない。** `ratchetIndex` が `CONTRIBUTING.md` を
  # 歩く。数え上げると、増やしたファイル名は当然その列挙に無いので
  # **まさにそのコミットでだけ走らない**。
  # `case` は最初に当たった腕で止まるので、深いパスを先に落としてから見る
  case "$path" in
    */*) ;;
    *.md) needs_ts=1 ;;
  esac
done < <(git status --porcelain --untracked-files=no)

if [ "$needs_ts" -eq 0 ] && [ "$needs_rust" -eq 0 ]; then
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

[ "$needs_ts" -eq 1 ] && run_gate "npm run verify" npm run verify
[ "$needs_rust" -eq 1 ] && run_gate "npm run verify:rust" npm run verify:rust

exit 0
