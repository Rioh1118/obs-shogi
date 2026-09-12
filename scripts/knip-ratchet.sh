#!/usr/bin/env bash
# 到達しない export・型・ファイルを、増える方向にだけ落とす。
#
# **0 にはできない。** `src/entities/game-session/**` は、未マージの
# エンジン作業が使う Tauri コマンドの薄皮で、`src/main.tsx` からは到達しない。
# 消すと合流時に書き直しになる。数だけ見れば今日から張れて、
# 新しく死んだ export はその場で止まる。
#
# **「ファイルが到達しない」から「export が到達しない」へ移ると数が跳ねる。**
# 到達しないファイルは1件、到達するファイルの中で使われていない export は1件ずつ
# 数えるため。`entities/game/lib` が `Side` を型として読んだ時点で
# あのスライスは「到達する」側へ移り、残りの型がまとめて数に乗った。
# **増えたのは死んだ公開面ではなく、見えるようになった公開面。**
#
# `oxlint` の `no-unused-vars` は **export された宣言を見ない**ので、
# 到達しない公開面はこれが唯一の門番。
#
# **減らしたら BASELINE を下げること。** 下げないと、次に増えたぶんが隠れる。
set -uo pipefail

# `npm run deadcode` と同じ範囲（未使用ファイル・未使用 export・未使用の型）の合計。
# **減らしたらここを下げること。**
BASELINE=176
# **テストからの import も「消費」に数える。** 本番から到達しない barrel の export でも、
# テストが1本 import すればこの数から消える——**減った理由が「死んだ export を消した」とは
# 限らない。** 下げる前に、減ったぶんが何かを `npx knip --reporter json` で見ること
# （計測を本番 entry だけに寄せる案は `.claude/knowledge/mechanization-backlog.md`）。

cd "$(dirname "$0")/.."

# **人間向けの出力を正規表現で数えない。** 見出しの綴りは版で変わるし、
# knip が途中で失敗したときは見出しが1行も出ない。
# そこを `grep | grep | awk` で数えると、`pipefail` で**何も言わずに exit 1** になり、
# 「基準より増えた」と区別が付かない（実際にそれで CI が黙って落ちた）。
#
# JSON は形が決まっていて、失敗すれば解析が落ちるので**区別できる**。
#
# **stderr を stdout へ混ぜない。** `npx` は `npm warn ...` を stderr に出すことがあり、
# 混ぜると JSON の手前に1行載って解析が必ず落ちる（実際にそれで落ちた）。
# 診断のために取っておきたいので、捨てずに別へ受ける。
knip_stderr=$(mktemp)
trap 'rm -f "$knip_stderr"' EXIT
output=$(npx knip --include exports,types,files --reporter json --no-progress 2>"$knip_stderr")
knip_status=$?

# knip は指摘があると 1、無ければ 0、自分が壊れたときは 1 以外を返す。
if [ "$knip_status" -ne 0 ] && [ "$knip_status" -ne 1 ]; then
  echo "knip が実行できなかった（終了コード ${knip_status}）" >&2
  cat "$knip_stderr" >&2
  printf '%s\n' "$output" >&2
  exit 1
fi

# **`0` を返す経路と、数えられなかった経路を分ける。**
# 解析できなければ数を返さず、生の出力を添えて落とす。
count=$(printf '%s' "$output" | node -e '
  let raw = "";
  process.stdin.on("data", (c) => (raw += c));
  process.stdin.on("end", () => {
    let r;
    try {
      r = JSON.parse(raw);
    } catch {
      process.exit(2);
    }
    if (!Array.isArray(r.files) || !Array.isArray(r.issues)) process.exit(2);
    let n = r.files.length;
    for (const i of r.issues) {
      n += (i.exports ?? []).length + (i.types ?? []).length;
    }
    process.stdout.write(String(n));
  });
')

if [ -z "$count" ]; then
  echo "knip の出力を解析できなかった。数えていないので緑にしない" >&2
  echo "--- stderr ---" >&2
  cat "$knip_stderr" >&2
  echo "--- stdout（先頭2000字）---" >&2
  printf '%.2000s\n' "$output" >&2
  exit 1
fi

if [ "$count" -gt "$BASELINE" ]; then
  echo "到達しない export/型/ファイルが増えた: ${count}（基準 ${BASELINE}）" >&2
  echo "" >&2
  npx knip --include exports,types,files --no-progress >&2 2>&1 || true
  exit 1
fi

if [ "$count" -lt "$BASELINE" ]; then
  echo "到達しない export/型/ファイルが ${count} 件に減った。scripts/knip-ratchet.sh の BASELINE を下げること" >&2
  exit 1
fi

echo "knip unused: $count (baseline $BASELINE)"
