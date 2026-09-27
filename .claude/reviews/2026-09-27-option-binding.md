# レビュー option-binding

- 日付: 2026-09-27
- 範囲: `feat/option-binding`（origin/main b1d0e566 からの差分。PR F: 評価関数・定跡をどの名前で送るかを、エンジンの申告から Rust が決める）
- 走らせた reviewer: rust / robustness / architecture / comment
- 対象コミット: 1巡目は未コミットの作業ツリーを見た。直しは本体と同じコミットに入っている（本体が未コミットのまま所見を受けたため、1所見1コミットに割れない）

## 入れた機械

どれも直した箇所を戻す変異で落ちることを確かめた。

- TS `usiNamesStayInRust`: TS のソース（文字列リテラルとオブジェクトの鍵。`codeOf` 越し）が、`binding.rs` と `analysis_fixed_values` の綴る USI の名前を綴らないこと。名前は Rust のソースから拾い、拾えた件数に下限を置いた（rust / architecture）
- Rust layering `TEST_ONLY_EDGES` と `test_only_edges_stay_in_the_tests`: テストだけが使う依存（`binding` → `option_line`）を本番の依存の向きの検査から外し、本番に漏れたら落ちる（本番のコードで `option_line` を使う変異で2本とも落ちる）
- Rust layering `engine_option_literals`: `EngineOption` を組む口の走査を括弧の対応で読み、分割代入の形（`..` で終わる / `->` / `struct`）を拾わない。走査自身のテストつき
- Rust `binding.rs` の表のテスト（1巡目の所見ごと）: 送れなかった定跡を切る／`no_book` を申告どおりの綴りで／切れないときの `bookCannotBeDisabled`／`evalNotChosen`／`check` の大小／大小まで一致する選択肢を先に／定跡を受ける名前の利用者の値は定跡を送らない回も送らない
- TS `engineStartWarningBridge`: `notDeclared` だけの起動ではトーストを出さない（出す変異で落ちる）

## 直した所見

- 定跡を送れなかったのに `USI_OwnBook=true` を送り、エンジンが自分の既定の定跡で引く（robustness / rust）→ 送れなかったら切る
- 切るときの `BookFile` の綴りが固定（rust）→ 申告どおり。切る口が無ければ `bookCannotBeDisabled`
- 評価関数がフォルダかを起こした後に見て、取り消せなかった（rust）→ 起こす前に、上限2秒・取り消しに従う
- 既定で入る値を申告しないエンジンで起動のたびに `notDeclared` のトースト（robustness）→ 出さない
- 型の合わない値で起動を断る（robustness）→ 送らずに警告 `invalidType`
- 評価関数を選んでいないことが伝わらない（robustness）→ `evalNotChosen`
- パスの改行・長さを起こす前に見ていない（rust）→ `validate_input` に入れた
- B1 で大小を無視して先に当てる（rust）→ 大小まで一致するものを先に
- 固定値が `binding.rs` の中に居た（architecture）→ 呼び手が `fixed` で渡す
- 起動の警告の効果が `EngineFailureBridge` に同居（architecture）→ `EngineStartWarningBridge` に分けた
- doc: 判定表の書き直し、`InvalidValue` の doc、`bookEnabled` / `evalFilePath` の doc、履歴の語（comment）

## 送ったもの

- `docs/IDEAS.md`「評価関数・定跡の流し先で、判定表に載せていない形」: E3 / E4 でファイル名が送られない（robustness）／`DNN_Model` と `EvalDir` を両方申告するエンジン（rust。実機未確認）／`bookEnabled`・`evalFilePath` の改名（comment / architecture）／B1 で絶対パスを送れるエンジンの判定（G の `book_file_accepts_path`）

## 機械にできなかったもの

- 判定表の行が現物のエンジンの挙動と合っているか（実機の申告の fixture は3つだけ。E1 / E4 / B3 は1行の申告）
- `mechanization-backlog.md` への書き戻しは無し（USI の名前の走査・テストだけの依存は表に無い類型で、1件目で機械にした）

## 見ていない範囲

- 実機のエンジンを起動して定跡・評価関数が読まれることの確認（実プロセスは台本の `EvalFile` 1本だけ）
- トーストの見た目
- Windows
