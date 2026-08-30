# レビュー book-foundation ラウンド14

- 日付: 2026-08-30
- 範囲: `src-tauri/src/book/`、`src-tauri/src/lib.rs` の book 登録部分、`.claude/hooks/verify-gate.*`、`docs/state-transitions/`
- 走らせた reviewer: rust / robustness / comment
- 前ラウンド: `-r1.md`〜`-r13.md`（計196件）

**3体とも同じ核心を指した。** R13 R-04 で「最長を固定した」つもりのテストが、最長を通していなかった。

## 所見

### S-01 [HIGH] 受理集合の長さに上限が無く、最長を固定したはずのテストが何も守っていない

3体全員。`sfen.rs:188-197,544-573`。

robustness が `sfen.rs` を独立クレートへ切り出して実測:

```
=== MAX_INPUT_CHARS=192 ===  test result: ok. 24 passed
=== MAX_INPUT_CHARS=180 ===  test result: ok. 24 passed
=== MAX_INPUT_CHARS=160 ===  FAILED: a_long_token_is_truncated_in_the_reason（不変条件2の側）
```

**`a_maximally_spelled_board_is_accepted` は 192 まで詰めても落ちない。** 通す入力は 155 字だが、
正当な入力はもっと長い:

- 持駒の枚数 `1` を明示する綴り（`1P1P…`）で 193 字が `Ok`
- 先頭ゼロ（`0`×50 + `1G`、手数 `0`×18 + `1`）で**長さに上限が無い**

つまり表の「A 正しい局面 × 全体 > 256 字 = 到達不能」も、不変条件1も**偽**だった。

→ 直す。robustness の案(2)を採り、**冗長な綴りを拒否して受理集合を閉じる。**
これで盤面と持駒の合計は駒の置き方によらず 127 字に決まり、最長は 155 字。
境界を等式で固定し、上限との関係はコンパイル時 assert で見る。

### S-02 [HIGH] 表の「変異で確認」が、そのテストでは起きない変異を書いていた

robustness / comment。`book-key-failures.md:85-87`。
「160 に詰めると落ちる」で落ちるのは別の不変条件のテスト。
**R13 R-07（照合欄が担っていない表を指す）と同じ形が、同じファイルの隣の行に残っていた。**

### S-03 [MEDIUM] `BookError` のフィールドが `pub` なので、`with_path` を迂回できる

rust。`error.rs:41-47`。doc は「打ち切りの関門は `with_path` ただ1つ」と宣言しているが、
構造体リテラルで組み立てれば型は何も止めない。
**R13 R-01 はまさに「経路が1つ増えたら取り残された」形で出た所見**で、その再発を型で止める設計になっていない。

同じファイル群に前例が2つある（`BookKey` / `HandCount`）。`BookError` だけがコメントの約束で止まっていた。

### S-04 [MEDIUM] `NotFound` / `Io` / `UnsupportedFormat` に復帰操作が無い

robustness。`error.rs:107-119`, `reader.rs:68-72`。
R2 G-07 は「io は kind ごとに次の操作まで書く」と決めたが、入ったのは `PermissionDenied` だけ。
**`open_reader` は成功経路を持たないので、今この機能を触った利用者が必ず見る文字列**
（`UnsupportedFormat`）にも復帰操作が無い。

### S-05 [BLOCK] 最長局面のテストのコメントが、2行下の盤面リテラルと食い違う

comment。`sfen.rs:550-552`。「40枚を全て盤に置き」「空きマス41」と書いてあるが、
実測すると盤上は36枚・空きマス45。R13 で盤面を書き換える前の記述が残っていた。

### S-06 [MEDIUM] `rejects_input_that_is_not_a_position` の doc が「3つの枝」だが実際は4枝

comment。表の C 行の `G5 ✓` にテスト名が無く、その唯一の裏がこのテストであることが書かれていない。

### S-07 [MEDIUM] 「検査で弾いていた頃は」という経緯がテストの doc に残っている

comment。`api.rs:547-551`。R13 の修正で新しく入った。

### S-08 [MEDIUM] 表が存在しないテスト名を指している

comment。`a_long_input_is_truncated_in_the_message` は repo のどこにも無い。
取り消し線で残した「埋めた」項目も、「埋まっていないセル」の見出しの下に残り続けている。

### S-09 [MEDIUM] 2つの表が `docs/state-transitions/README.md` の索引に無い

comment。**main 側で `stateTransitionIndex.test.ts`（索引と実ファイルの一致を見るテスト）が
追加されていたので、これは実際に落ちる。**

## main の取り込み

作業中にユーザーから「main に大きなマージがある」と連絡があり、`origin/main` が108コミット進んでいた
（`refactor/163-entities-kifu`）。

- `git merge-tree` で事前確認 → **衝突なし**（重なるのは `docs/state-transitions/README.md` だけで、
  私はそれまで触っていなかった）
- `git merge origin/main` で取り込み。85コミットを rebase で書き換えるより安全と判断した
- **意味の衝突が1件あった。** main の `stateTransitionIndex.test.ts` は「`docs/state-transitions/` の
  全 `.md` が README から参照されていること」を見るので、私の表2つを索引に載せないと落ちる。
  S-09 として直した

## 重複・矛盾した所見

- S-01 は3体全員。**「テストが名前どおりの性質を固定していない」は R9 から6ラウンド連続**
- S-02 / S-08 は表そのものの誤りで、**R13 R-03 / R-06 / R-07 に続いて2ラウンド連続**
- S-01 の直し方について robustness は (1) テストを実際の最長に合わせる / (2) 受理集合を閉じる の両論。
  **(2) を採った。** (1) だと先頭ゼロで長さが閉じないままなので、「最長」という概念が成立しない

## 見ていない範囲

- フロント側（`src/`）。book コマンドの呼び出しは R1 から0件のまま
- 実際の定跡ファイルでの動作。`open_reader` は今も必ず `Err`
- やねうら王 `source/book/book.h` / `Position::sfen()` の一次資料
- Windows / Linux の実行時挙動。実測は macOS のみ
- **冗長な綴りを拒否したことで、実在の定跡ファイルが `1P` のような綴りを使っていた場合に
  弾かれる。** #91 で fixture を置くときに突き合わせること
- 表に「埋まっていないセル」として残してある2件

## lint / hook で強制できるもの

- **コンパイル時 assert で境界を見る** — S-01 / S-02。
  `const _: () = assert!(MAX_INPUT_CHARS >= LONGEST_VALID_INPUT_CHARS);`。
  定数を詰めるとテストが落ちるのではなく**コンパイルが通らない**ので、変異の記述が腐らない
- **フィールドを private にする** — S-03。バイパスがコンパイルエラーになる
- **文面を見るテスト** — S-04。種別だけを見るテストでは、案内文を空にしても緑
- **索引と実ファイルの一致を見るテスト** — S-09。main 側に既にある
- 表の記述の腐り（S-02 / S-08）は機械では拾えない。**変異の記述は、落ちるテスト名と境界値まで書く**

## 修正結果

| 所見                             | 結果   | コミット  |
| -------------------------------- | ------ | --------- |
| S-01 / S-03 / S-04 / S-05 / S-06 | 直した | `8a72277` |
| （main の取り込み）              | —      | `c16de54` |
| S-02 / S-07 / S-08 / S-09        | 直した | `a0c2533` |

## 変異による確認

| 壊した箇所                         | 結果                                                                 |
| ---------------------------------- | -------------------------------------------------------------------- |
| `MAX_INPUT_CHARS` を 154 に詰める  | **コンパイルが通らない**（`evaluation panicked: assertion failed`）  |
| 冗長な綴り（枚数 `1`）の拒否を外す | `rejects_redundant_spellings_that_would_unbound_the_length` が落ちた |

## 検証

`npm run verify:rust` を通した。book のテストは 61件。
**このワークツリーに依存を入れて `npm run verify` も通した**（22ファイル / 210件）。
main を取り込んだので TS 側も一度通す必要があった。索引テストもここに含まれる。
`bash .claude/hooks/verify-gate.test.sh` も通した。
