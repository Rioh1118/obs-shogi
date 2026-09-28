# レビュー book-file-path

- 日付: 2026-09-28
- 範囲: `feat/book-file-path`（origin/main 590551dc からの差分。PR G3: 選択肢に無い名前の定跡を、パスを受けるエンジンにはパスで送る）
- 走らせた reviewer: rust / robustness / comment（robustness は実機の V8.30 / V9.00 を repo の外で動かして出力を測った）
- 対象コミット: b7280e77（1巡目。本体）

## 入れた機械

どれも直した箇所を戻す変異で落ちることを確かめた。

- **実機の出力を fixture に**（rust / robustness）: `tests/fixtures/usi/yaneuraou-book-lines.txt`（V9.00 の断る行、V8.30 の読んだ行、読めない行）。`the_real_v900_rejection_line_is_read_as_a_rejection` が実機の行を `usi` crate の解析に通して「断り」と読めることを見る（照合を元の綴りに戻す変異で落ちる）。`a_sent_book_path_is_checked_against_what_the_engine_said` が読んだ・読めない行で判じる
- 台本（断る・読む・読めない・黙る・答えない・落ちる）で `start_engine` の送る行と警告を見る（読めたかの確かめを外す変異、答えないを「受ける」にする変異、直近の出力を添えない変異）
- `v830_and_v900_declare_the_book_the_same_way`: 定跡の申告が同じこと（判定表の前提。崩れたら申告で見分けられるかを見直す）
- 警告の種類を足したので、線の綴りのテスト（Rust）と TS の写しのテストがそれぞれ落ち、足して通した（既存の機械が効いた）

## 直した所見

- **「断る行が出なかった」を「受ける」と読んでいた**（rust / robustness。HIGH）: 黙って捨てるエンジン・別の綴りで断るエンジンでパスを送り、別の定跡で黙って動く → 送った後に読めたかを `readyok` までの出力で確かめる（`book_load_warning`）→ 776d573f
- 受けたが読めないファイルで、定跡なしで黙って動く（robustness。実測）→ `bookNotLoaded` → 776d573f
- 答えない回が「名前しか読めない」の警告になる（rust / robustness）→ 3値（`BookPathSupport`）と `bookPathCheckTimedOut`、ログ → 776d573f
- 確かめの途中で落ちたとき直近の出力が無い（rust / robustness）→ 776d573f
- B1 のコメントが送る分岐と食い違う（comment。BLOCK）、上書きの前提、判定表の「5 秒」「1本だけ」「申告が同じ」、`book_path_check` の名前（comment）→ 776d573f

## 送ったもの / 直さなかったもの

- 確かめの上限を最初の `usi` の所要時間から決める案（robustness）: 固定の `BOOK_PATH_CHECK_LIMIT` のまま。答えない回は別の警告で「もう一度起動」を案内する
- やねうら王以外（フォーク・他の版）の断り方・読み方の実測（robustness の見ていない範囲）: 読んだと言わなければ `bookLoadUnconfirmed` で知らせるので、黙って別の定跡では動かない

## 機械にできなかったもの

- 警告の文言（`startWarningNotice.ts`）の分かりやすさ

## 見ていない範囲

- このアプリからの実機（V8.30 / V9.00）での通し。実機の出力は robustness が repo の外で測った行を fixture にした
- Windows（一時フォルダのパスに空白・非 ASCII が入る場合）
