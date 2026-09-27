# レビュー engine-options-values

- 日付: 2026-09-27
- 範囲: `feat/engine-options-ui`（origin/main 296e2a38 からの差分。PR G2a: 決め打ちの7項目をやめて値の無い名前をエンジン既定にし、取得した定義に値を当てる）
- 走らせた reviewer: react / architecture / robustness / comment
- 対象コミット: 28c97bf4（1巡目。本体）

## 入れた機械

どれも直した箇所を戻す変異で落ちることを確かめた。

- **画面と送る側の規則を同じ表で固定した**（architecture）: `src-tauri/tests/fixtures/option_fit_cases.json` を Rust の `user_values_follow_the_shared_fit_table` と TS の `fitValues.ratchet.test.ts` が当てる（TS の i64 の境を外す変異・Rust の combo を大小無視にする変異で、それぞれ落ちる）。Rust 側は保存する定義の形（`UsiOptionDef`）が表の `def` と一致することも見る。CONTRIBUTING の表に行を足した → 0cfc0eaf
- 外した理由の型を `StartWarning["kind"]` から引く（片方だけの改名は tsc が落とす）→ 0cfc0eaf
- `presetDialogProbe.test.tsx`: 同じエンジンで取り直しても一覧が消えない／A で外した値を受ける B に選び直すと戻る／読み直しで一覧が消える（当てる元を下書きにする変異・一覧を消さない変異・編集を当てる元に重ねない変異）→ ec335c60
- 同: MultiPV の入力欄を空にするとエンジン既定／丸められてボタンに無い値になると入力欄が開いて値が出る／既定値の表示と「候補が1本」の注記／その他の値を外せる → ab7f9618
- 2巡目: 上の全部に変異を当て直した。読み直しのテストは、読み直しでエンジンのパスが変わって一覧が別の理由で隠れていた（変異が効かなかった）ので、同じエンジンで読み直す形に直した

## 直した所見

- 取得のたびに当てた後の下書きから当て直し、A→B で外した値が戻らず一覧も消えて保存で黙って消える／取り直すと一覧が消える（architecture / robustness。HIGH）→ ec335c60
- 取得の結果を値で `setDraft` に渡し、まだ描画されていない更新を上書きしうる（react）→ ec335c60
- 読み直しで下書きが戻っても一覧が残る（architecture / comment）→ ec335c60
- TS と Rust で i64 を超える整数の扱いがずれていた（architecture）→ 0cfc0eaf
- 外した理由「評価関数・定跡の欄で決まる」が解析の固定値に当たらない（comment / robustness）→ 0cfc0eaf
- 丸めの行に元の値と範囲が無い（robustness）→ 0cfc0eaf
- 「エンジン既定」がいくつか分からない、「送らない」は送信の語（robustness）→ ab7f9618
- MultiPV の入力欄を空にすると 1 が入る（robustness）→ ab7f9618
- 丸めでボタンに無い値になると MultiPV が画面から見えない（react）→ ab7f9618
- 欄の無い保存済みの値を見る・消す口が G2b まで無い（architecture）→ ab7f9618（「その他の保存済みの値」）
- doc / 仕様: `FIRST_HASH` の条件（BLOCK）、「そのまま送られる」「画面だけの状態を持たない」「MultiPV の範囲」、engine-options.md の経緯の語、`withDefinitions` が指す段、計画の G2a/G2b（comment / architecture）→ ab7f9618

## 送ったもの / 直さなかったもの

- 当てる規則を Rust のコマンドにして TS の写しを消す案（architecture の案1）は採らず、同じ表を当てる案（案2）にした。取得の後に IPC を1往復増やさず、表でずれは落ちる
- ダイアログの状態（当てる元の値・一覧・取得）を reducer に寄せる → G2b（計画 §4）

## 機械にできなかったもの

- 文言の分かりやすさ、仕様の断言の正しさ（`mechanization-backlog.md` の「機械では止まらないもの」1）

## 見ていない範囲

- 実機のエンジンでの取得と当て（台本のエンジンと表だけ）
- 保存済みの実際のプリセットファイル（7項目が全員に入っているかはコードからの推定）
