# レビュー yaneuraou-db ラウンド2

- 日付: 2026-08-30
- 範囲: `src-tauri/src/book/`、`docs/state-transitions/yaneuraou-db-parse.md`
- 走らせた reviewer: rust / robustness / comment
- 前ラウンド: `-r1.md`（19件、HIGH 5件）

重複を除いて **9件**。BLOCK 1件・HIGH 3件。**うち1件はラウンド1で私が作った退行。**

**robustness が実物の最大の公開定跡を取得して測った。** これが決定的だった。

|                                               | 値                            |
| --------------------------------------------- | ----------------------------- |
| `new_petabook_20250505c.7z` → `user_book1.db` | 493,157,464 B = **470.3 MiB** |
| 収録局面                                      | 2,252,118                     |
| `# NOE:` の有無                               | **無い**（`grep -c` で 0）    |

## 途中で表を書いた

ラウンド1に19件、ラウンド2に9件。その大半が「形式が実際どう書かれているか」の
取りこぼしで、1件ずつ潰す形では次の綴りに置いていかれる。
ユーザーの指示で `docs/state-transitions/yaneuraou-db-parse.md` を書いた。

**表を書いた直後に、表自身が3つのセルの穴を名指しした。**
(S0, E3) / (S0, E4) / (S2, E6) と、不変条件4の行数側。
どれもレビュアーが独立に HIGH で挙げたものと一致した。

## BLOCK

### B-01 申告局面数を、畳んだ後の数と突き合わせていた

rust（BLOCK）/ comment（HIGH）。**ラウンド1 A-04 で私が入れた退行。**

比べる相手を `positions.len()`（正規化して重複を畳んだ後のキー数）にしていた。
A-07（手数違いの重複を畳む）と正面から衝突する。実測:

```
重複あり（b - 1 と b - 31）  → ERR「2 局面と書かれているが 1 局面しか読めない」
持駒の綴り違い（2Pp と p2P） → 同上
空きマスの綴り違い          → 同上
```

文面は「途中で切れているかもしれない。取得し直すこと」。ファイルは完全なので
**何度取得し直しても直らない**。

NOE の定義は `sfen ` 行の本数（`YaneuraOuBookLib.py` の
`count_yaneuraou_db_positions`。やねうら王本体は NOE を読み書きしない）。

→ `sfen` 行の数と比べる形に直した。

## HIGH

### B-02 見出しより前の `#` / `//` 注記で、本家が読める定跡が開けない

rust。ヘッダ探索のループは空行しか飛ばしていなかった。A-01 で直したのと
同じ失敗が、ヘッダ探索の側に残っていた。→ 直した（表の (S0, E3) / (S0, E4)）。

### B-03 指し手の欄の `none` / `None` / `resign` が候補手になる

rust / comment。本家は指し手の欄でも同じ3綴りを見る（`book.cpp:118-119`）。
実測で `lookup -> ["none", "resign"]`。**盤に適用できない綴りが先頭＝best move の
位置に座る。** `ABSENT_MOVE` の doc 自身がこの危険を書いていたのに、応手にしか
当てていなかった。→ 直した（表の (S2, E6)）。

### B-04 確保の上界が、ファイルサイズでは取れない

comment（HIGH）/ robustness（実測）。`MAX_FILE_BYTES` の doc の
「最悪でも展開後 2GB 前後」が定数の唯一の根拠だったが、倍率は行数に効く。

```
実物 user_book1.db（5欄すべて）  470.3 MiB → 1.85 GB   （×3.76）
指し手だけの定跡（形式として正当） 10 MiB   → 92 MB    （×8.79）
1字の指し手行だけ                  64 MiB   → 2.72 GB  （×40.5）
```

最後の形は上限内で 21 GB 前後を確保しにいく。→ 上界を `MAX_MOVES` の側に置いた。

### B-05 上限 512MiB が実物の 91.9%

robustness（実測）。次の配布で実利用者が `TooLarge` に当たる。文面は
「分割された定跡を使うか」だが、**その定跡に分割配布は無く、アプリにも分割機能が無い**。
→ 2 GiB へ上げ、文面から存在しない操作を消した。不変条件はコンパイル時 assert に置き、
上限を実物へ近づけるとビルドが止まるようにした。

### B-06 申告が無い定跡では、切れの検出が一度も走らない

robustness（BLOCK 相当）。**実物に `# NOE:` は無い。** 100MB に切り詰めた実物は
`OK positions=527871` で開く。UI には「52万局面」というもっともらしい数字が出て、
利用者は 172 万局面ぶんが「未収録」に見える状態で研究を続ける。
→ 最終行が改行で終わらないことで見る。`# NOE:0` の迂回も塞いだ。

## MEDIUM

| 番号 | 所見                                                         | 結果   |
| ---- | ------------------------------------------------------------ | ------ |
| B-07 | 同ブロック内の重複が畳まれない / 併合が二乗（6.22MB で16秒） | 直した |
| B-08 | Shift_JIS の注記1行で定跡全体が拒否される                    | 直した |
| B-09 | 捨てた欄がログにも出ない / `sfen` が候補手になる             | 直した |

comment が挙げた `excerpt` の doc の所在の主張、`open_reader` の返る種別の列挙、
`flush` の不変条件、単位の綴りは、上の各コミットに畳んで直してある。

## 変異による確認

| 当てた変異                            | 落ちたテスト                                                          |
| ------------------------------------- | --------------------------------------------------------------------- |
| 畳んだ後の数と比べる                  | `a_book_with_duplicate_positions_is_not_mistaken_for_a_truncated_one` |
| 見出し前の注記を読み飛ばさない        | `notes_before_the_header_are_skipped`                                 |
| 指し手欄の `none`/`resign` を通す     | `an_absent_move_spelling_is_not_a_candidate`                          |
| 手数の上限を外す / 境界をずらす       | `a_book_with_too_many_moves_is_refused` ほか                          |
| 上限を 512MiB へ戻す                  | **`error[E0080]` でコンパイルが止まる**                               |
| 単位を 1024 進に戻す                  | `sizes_are_shown_in_the_same_unit_as_the_file_manager`                |
| 切れの検出を外す / 常に切れと見なす   | `a_file_cut_mid_line_is_rejected_...` ほか3件                         |
| 0局面の検査を申告側へ戻す             | `a_declared_count_of_zero_does_not_bypass_the_empty_check`            |
| ブロック内の重複を畳まない / 後勝ちに | 各2件                                                                 |
| 注記でも UTF-8 を要求する             | `a_note_in_another_encoding_does_not_reject_the_book`                 |
| 行番号を添えない                      | `an_unreadable_byte_outside_a_note_is_reported_with_its_line_number`  |
| `sfen` キーワードを通す               | `the_sfen_keyword_is_not_a_candidate_move`                            |
| 落とした欄を数えない / 空欄も数える   | 各1件                                                                 |

## 空振りした変異

**併合を走査だけに戻す変異はテストが落ちない。** 結果は同じで遅くなるだけなので、
単体テストでは区別できない。計算量の側は robustness の実測
（1.55MB → 1.10s / 3.11MB → 3.91s / 6.22MB → 16.26s）でしか押さえられていない。

**単位の最初のテストも空振りした。** `megabytes(MAX_FILE_BYTES)` と突き合わせて
いたので、関数を変えると両辺が同じだけ動く。リテラルで見る形に直した。
これは #238 で `contains(SFEN_RECOVERY)` を書いて踏んだのと同じ罠で、2度目。

## 検証

- `npm run verify` — 355 tests 通過
- `npm run verify:rust` — fmt / clippy / test 通過

book のテストは 103件 → 116件。
