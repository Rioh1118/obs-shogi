# レビュー yaneuraou-db ラウンド1

- 日付: 2026-08-30
- 範囲: `src-tauri/src/book/yaneuraou_db.rs`（新規）、`reader.rs`、`open.rs`、`sfen.rs`、`types.rs`、`error.rs`
- 走らせた reviewer: rust / robustness / perf / architecture / comment
- 基点: `feature/book`（#237 / #250 マージ済み）

重複を除いて **19件**。うち **HIGH 5件**。

**5体のうち3体が一次資料まで降りた。** rust はやねうら王本家の
`source/book/book.cpp` / `misc.cpp` と ShogiHome の実装を取得して読み、
robustness と perf は `yaneuraou_db.rs` を独立クレートへ切り出して実測した
（perf は `#[global_allocator]` で確保バイトを数えた決定的な値）。

## HIGH

### A-01 `//` で始まるコメント行を読み飛ばさない

rust。本家 `book.cpp:710-715` は `#` と `//` の両方を読み飛ばす。2通りに壊れる。

- `sfen` 行の後ろにあると**候補手として登録され、しかも先頭に来る**。
  形式は「先頭が best move」と約束しているので `//` が推奨手になる
- 最初の `sfen` より前にあると「局面より先に指し手」に落ち、
  **本家が普通に読める定跡が丸ごと開けなくなる**

→ 直した。

### A-02 上限が無く、巨大ファイルで SIGKILL

rust / robustness / architecture。実測 `exit=137`。`BookError` も panic も返らず、
`JoinError` にもならないので `Unknown` すら出ない。アプリが黙って消える。

**#197 は「reader の実装と同じ回で、実測に基づいて決めるのが正しい」と書いて
#90 で見送っていた。その回がこれ。** 「#197 で別扱い」という私の前提が誤りだった。

→ 直した。`TooLarge` を足し、上限 512MiB（根拠は perf の実測）。#197 へ書き戻した。

### A-03 指し手行を検証しないので、任意のテキストが候補手になる

robustness。実測:

```
候補手=["7g7f", "ここに別のテキストが連結された", "<html><body>404"]
usi_move の長さ=5000000 文字
```

→ 直した。綴りの一覧は持たず、形（7字以下の ASCII 英数字と `*` `+`）だけを見る。

### A-04 途中で切れた定跡が「0局面の定跡」として静かに開ける

robustness。ヘッダの検査は別形式しか止めない。切れた自ファイルは自分自身が
正しい見出しを持っている。**ファイルが `# NOE:1250000` と申告しているのに
読んでいなかった。**

→ 直した。申告値と展開後の実数を突き合わせる。申告の無い定跡のために
「0局面は成立しない」を保険にする。**申告値を確保には使わない**
（`# NOE:99999999999` で abort する。perf の指摘）。

### P-01 展開後がファイルの 4.4 倍、ピークが 5.4 倍

perf。所見2・3・5 を入れて **×5.39 → ×3.15、時間 -18%**。

→ 直した（A-P2 / A-P3 / A-P5）。

## MEDIUM

| 番号 | 所見                                                    | 結果           |
| ---- | ------------------------------------------------------- | -------------- |
| A-05 | 欄が空の行で評価値と深さがずれる（`split_whitespace`）  | 直した         |
| A-06 | `None` / `resign` の応手が指し手として通る              | 直した         |
| A-07 | 手数違いの重複で同じ指し手が2度返る                     | 直した         |
| A-08 | 壊れた `sfen` 行に行番号が無い                          | 直した         |
| A-09 | 行の引用にパス用の打ち切り（4096字）を流用              | 直した         |
| A-10 | `TODO(#91)` が3件腐る / `allow(dead_code)` 不要         | 直した         |
| A-11 | `position_count` の定義が types.rs の doc と食い違う    | 直した         |
| A-12 | `optional_number` の doc が損失規模を誤る               | 直した         |
| A-13 | UTF-8 失敗の案内に形式違いの話が無い                    | 直した         |
| A-14 | `entry().or_default()` のコメントが役目を説明していない | 直した         |
| A-15 | 見出しの失敗が「1行目」と決め打つ（空行を飛ばすので嘘） | 直した         |
| A-16 | `parse_move` の到達不能な枝2つ                          | A-05 で解消    |
| A-17 | `BookKey` が次の形式（Apery）から使えない               | **issue #275** |
| A-18 | `open.rs` のテスト doc に #90 の経緯                    | 直した         |
| A-19 | 受入条件の fixture が未達                               | **issue #291** |
| P-04 | 指し手の綴りを1手ずつ確保（13,689通りしかない）         | **issue #274** |

## 変異による確認

| 当てた変異                         | 落ちたテスト                                              |
| ---------------------------------- | --------------------------------------------------------- |
| `//` を読み飛ばさない              | `skips_slash_comments_between_moves` ほか2件              |
| `split_whitespace` へ戻す          | `an_empty_field_does_not_shift_the_columns`               |
| `none` だけを見る                  | `every_spelling_of_an_absent_ponder_is_dropped`           |
| 指し手の無い局面を登録しない       | `a_position_without_moves_is_still_counted`               |
| 2度目の局面を捨てる                | `merges_a_position_that_appears_twice`                    |
| 壊れた `sfen` 行に行番号を添えない | `a_broken_line_carries_its_line_number`                   |
| 見出しを1行目と決め打つ            | `the_header_error_points_at_the_line_it_actually_read`    |
| 引用にパス用の打ち切りを使う       | `a_long_first_line_is_cut_to_the_excerpt_budget`          |
| 指し手の形の検査を外す             | `text_that_is_not_a_move_is_rejected`                     |
| 一覧で弾く形に厳しくする           | `every_real_move_spelling_is_accepted`                    |
| 申告との突き合わせを外す           | `a_truncated_file_is_caught_by_its_own_declared_count`    |
| 0局面の保険を外す                  | `a_book_without_positions_is_rejected`                    |
| 上限の検査を外す                   | `a_file_over_the_limit_is_refused_before_reading_it`      |
| 境界を1バイトずらす                | `a_file_at_the_limit_is_not_refused_for_its_size`         |
| 種別を `InvalidContent` に混ぜる   | 上限のテスト                                              |
| 重複を除かず連ねる / 後勝ちにする  | `a_move_written_twice_for_the_same_position_is_kept_once` |

## 手順から外れたこと

**P-05 のコミットに A-08 / A-15（行番号）を混ぜた。** 1コミット1所見の規則から
外れている。行番号の修正は読み込みのループの書き直しと同じ行に乗っており、
分けるには同じ箇所を2度書き直すことになる。分けた方が読みやすいとは判断しなかった。
A-09（引用の予算）は分離できたので別コミットにしてある。

## 自分の前提が誤っていた点

**「大きいファイルの上限・進捗・中断は #197。ここでは扱わない」と doc に書いた。**
#197 の本文は逆に「reader の実装と同じ回で決めるのが正しい」と書いており、
issue 側が名指ししていた回をこちらが押し返していた。architecture が指摘するまで
issue を読み直していない。

## 検証

- `npm run verify` — 355 tests 通過
- `npm run verify:rust` — fmt / clippy / test（lib 124件・root_guard 9件）通過

book のテストは 69件 → 103件。
