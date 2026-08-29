# レビュー book-foundation ラウンド15

- 日付: 2026-08-30
- 範囲: `src-tauri/src/book/`、`src-tauri/src/lib.rs` の book 登録部分、`.claude/hooks/verify-gate.*`、`docs/state-transitions/`
- 走らせた reviewer: rust / robustness / comment
- 前ラウンド: `-r1.md`〜`-r14.md`（計206件）

**R14 で「受理集合を閉じた」と書いた判断のうち、2点が誤りだった。** 片方は閉じておらず、
もう片方はそもそも閉じるのに要らないのに正当な入力を弾いていた。

## 所見

### T-01 [BLOCK] 手数の検査が閉じていない。`+` 付きで長さの上限が消える

rust / robustness。`sfen.rs`。

R14 は先頭ゼロを `ply.starts_with('0')` で弾き、「これで手数の綴りは一意」と結論した。
しかし `u32::from_str` は**先頭の `+` を受け付ける**。

```
"+0000000000000000001".parse::<u32>()  →  Ok(1)
```

`starts_with('0')` は外れ、`parse` は通る。同じ手数 1 を好きなだけ長く書けるので、
`MAX_INPUT_CHARS` の根拠（＝正当な入力には最長がある）が成立していなかった。

→ 直した。`parse` に任せず綴りで判定する（全桁が ASCII 数字 / 先頭ゼロなし）。

### T-02 [HIGH] 持駒の枚数 `1` の拒否は、長さを閉じるのに要らず、正当な SFEN を弾いていた

robustness。`sfen.rs` の `hand_count::parse`。

R14 は「冗長な綴り」として `1P` を拒否した。これは**二重に誤り**だった。

1. **長さを閉じるのに要らない。** 枚数の綴りは1駒あたり2字で頭打ちなので、`1P` を
   受け付けても最長は有限（193字）。長さを無限にしていたのは先頭ゼロだけ。
2. **`1P` は SFEN として正当。** 書き出す側は普通省くが、読み手は受理する。
   この repo が依存している tsshogi も受理する。

つまり R14 は、閉じるのに寄与しない拒否で**正当な入力を落としていた**。

→ 直した。先頭ゼロの拒否だけ残し、`1P` は受理側へ戻す。

### T-03 [HIGH] 「盤面と持駒の合計は駒の置き方によらず127字」が偽

rust / comment。`sfen.rs` の `MAX_INPUT_CHARS` の doc。

「駒を盤から持駒へ移すと盤面が1字縮み持駒が1字増える」は、持駒が1駒1字のときだけ成り立つ。
`1P` を受理するなら持駒は1駒2字になりうるので、合計は置き方で**変わる**。127 は最大値としてのみ正しい。

→ 直した。**最大** 165 字（盤上を玉2枚だけにし、残り38枚を1枚ずつ持駒に書いた形）と書き直し、
全体の最長を 193 字とした。

### T-04 [HIGH] 長さを生の文字数で測っており、空白を挟んだ正当な局面が落ちる

robustness。`sfen.rs` の入口の検査。

区切りの空白はいくつ挟んでも同じ局面を指す。生の `chars().count()` で測ると、
空白を並べただけの正当な局面が「局面として長すぎる」で落ちる。

→ 直した。トークンの合計（各トークンの字数 + 区切り1字）で数える。

### T-05 [MEDIUM] `const` がテストの doc コメントを吸い、文が重複していた

comment。`LONGEST_VALID_INPUT_CHARS` の直上に「不変条件1: 合法な局面は必ず通る」が置かれ、
テスト本体ではなく定数の doc になっていた。加えて「正当な入力の最長。」が2行続いていた。

→ 直した。定数には数式だけを置き、不変条件の説明はテストの doc へ戻した。

### T-06 [MEDIUM] 打ち切りのテストが、狙った枝に落ちたことを確かめていない

rust / robustness。`a_long_token_is_truncated_in_the_reason`。

4つの入力で「`…` が入っていること」だけを見ていた。どの枝で理由文が組まれたかを見ないので、
検査の順序が変われば**別の枝へずれても緑のまま通る**。実際 R14 の変更で4件目が
「駒が続かない」から別の枝へずれていた。

→ 直した。入力ごとに期待する理由文を持たせ、`message` がそれを含むことを assert する。

### T-07 [MEDIUM] 状態遷移表に手数の綴りの検査が状態として無い

robustness。`docs/state-transitions/book-key-failures.md`。

G7 が `ply.parse` の1セルにまとまっており、T-01 の穴は表の上でも見えなかった。

→ 直した。G7a（綴り）/ G7b（範囲）に割り、G0 をトークン合計に、G10 に先頭ゼロを追記。
行 A / C / F と不変条件1、照合欄も実態に合わせた。

### T-08 [MEDIUM] `UnsupportedFormat` の案内文を読むテストが1本も無い

robustness。`reader.rs`。

`open_reader` は #90 の範囲では成功経路を持たないので、この文面が**今この機能を触った
利用者に届く唯一の文面**。種別 (`code()`) だけを見るテストしか無く、案内を空文字にしても
緑のまま通った。

→ 直した。形式名と「他を試しても同じ結果になる」旨が文面にあることを見るテストを足した。

### T-09 [LOW] `BookError` の doc に変更の経緯が残っていた

comment。「実際、打ち切りを呼び出し側に置いていたときは6経路のうち1つにしか掛かっていなかった」。
CLAUDE.md の「変更の経緯を書かない」に反する。git log と PR に残る。

→ 直した。

### T-10 [LOW] テストの意図がコメントに無い

comment。T-06 のテストは「なぜ理由文まで見るのか」が書かれていなかった。

→ 直した。「打ち切りの跡の数だけを見ると、検査の順序が変わって別の枝へずれても緑のまま通る」を書いた。

## 変異による確認

3つの防御それぞれに、それを壊す変異を当てた。

```
=== M1: 上限を 192 に詰める ===
error[E0080]: evaluation panicked: assertion failed: MAX_INPUT_CHARS >= LONGEST_VALID_INPUT_CHARS
  → コンパイルが通らない（実行にも至らない）

=== M2: 手数の綴りの検査を parse 任せに戻す ===
    book::sfen::tests::a_long_token_is_truncated_in_the_reason
    book::sfen::tests::rejects_spellings_that_would_unbound_the_length
test result: FAILED. 62 passed; 2 failed

=== M3: 長さを生の文字数で測る ===
    book::sfen::tests::extra_whitespace_does_not_make_a_position_too_long
test result: FAILED. 63 passed; 1 failed

=== 復帰 ===
test result: ok. 64 passed; 0 failed
```

## R14 の判断を覆したことについて

R14 の S-01 は「冗長な綴りを拒否して受理集合を閉じる」と決めた。方向は正しかったが、
**何が冗長かの判定を、実装（`u32::from_str` の挙動）と仕様（SFEN として何が正当か）の
どちらでも確かめずに決めた。** 結果、閉じるべき穴（`+`）を残し、閉じる必要のない
正当な綴り（`1P`）を塞いだ。

これは「コメントに書いた理由が、実装している条件と違う」（`/implement` が名指しする故障）の
変種で、**理由の側が外部の挙動を誤って前提していた**形。今回は reviewer が
`sfen.rs` を独立クレートへ切り出して実測したことで見つかった。

## 検証

- `npm run verify` — 22 files / 210 tests 通過
- `npm run verify:rust` — fmt / clippy / test（book 64件）通過
- `bash .claude/hooks/verify-gate.test.sh` — 全て期待どおり

## このラウンドの外で見つけたもの

**verify-gate が `git rebase --abort` を塞いでいる。**

main が force-push で書き換わっていたため載せ替えをやり直したが、競合を抱えた状態で
`git rebase --abort` を打つと、ゲートが `npm run verify` を走らせ、競合マーカ入りの
`package.json` を npm がパースできずに deny する。
**競合を畳む手段そのものが取り上げられ、行き止まりになる。**

`--abort` / `--quit` / `--skip` はコミットを1つも作らないので、検証を要求する理由が無い
（`--continue` は作るので対象外）。ラウンド16 の所見として扱う。
