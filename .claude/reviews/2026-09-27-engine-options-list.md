# レビュー engine-options-list

- 日付: 2026-09-27
- 範囲: `feat/engine-options-list`（origin/main e98c95e8 からの差分。PR G2b: ダイアログの状態を reducer に、エンジンが申告した全部のオプションを型ごとの欄で編集）
- 走らせた reviewer: react / ui / robustness / comment / architecture
- 対象コミット: dcbdfe7d・b63301cf（1巡目。本体）

## 入れた機械

どれも直した箇所を戻す変異で落ちることを確かめた。

- **全部の欄の spin も送る側と同じ表で固定**（comment / architecture）: `fitValues` から `fitSpin` を出し、欄の確定（`commitSpinInput`）も通す。`spinInput.ratchet.test.ts` が `option_fit_cases.json` の spin の行を当てる。表に範囲が逆順の行を2件（Rust と TS の両方が当てる。入れ替えを外す変異で両方落ちる）。CONTRIBUTING の表に行 → a0dbb9e2
- 判定表の ✓ のうちテストが無かった3セル（P0 の A、P1 の V・F2）のテスト（comment）→ 2b61c15e
- `optionRows`: 重要オプションの3つを出さない／同じ名前の申告は1行／アプリが決める名前の無い定義では欄を作らない（それぞれを外す変異）→ 2b61c15e
- reducer: 戻すのは挙げた名前だけ、一覧も消す（全部消す変異・一覧を残す変異）→ 2b61c15e
- `commitSpinInput`: 保存済みと同じなら確定しない（確定する変異）→ a0dbb9e2
- ダイアログ: ファイルを選ぶ画面を開けなければ理由を出す（出さない変異）／絞り込み中は表示中の行だけ戻す／読み取り専用の欄に既定値を出さない → 2b61c15e

## 直した所見

- 重要オプションの3つが全部の欄にも出て、違う範囲で二重に編集でき、MultiPV を 8 より大きくできた（architecture。HIGH）→ 2b61c15e
- 「すべてエンジン既定に戻す」が見えない行と別の節の値まで消す（robustness。HIGH）→ 2b61c15e
- reservedNames を持たない定義で、アプリが決める欄が編集できるように見える（robustness。HIGH）→ 2b61c15e
- ファイルを選ぶ画面の失敗を黙る（robustness。HIGH）→ 2b61c15e
- 入力＋ボタンが横に並ばない（ui。HIGH）→ 2b61c15e（`presetDialog__inputRow`）
- 判定表の ✓ の嘘・F1 の発生源（comment。HIGH）→ 2b61c15e
- `commitSpin` の「送る側と同じ規則」が逆順の範囲で嘘（comment BLOCK / architecture）→ a0dbb9e2
- 読めない spin の入力で入力前の値を「編集」として確定し、当てる元の値を書き換える（react）→ a0dbb9e2
- 同じ名前の申告で key が衝突（react）→ 2b61c15e
- 読み取り専用の欄に「エンジン既定（…）」（ui / robustness / architecture）→ 2b61c15e
- 太字だけの印と件数の数え方の食い違い、「変えた値」の語の割れ（ui / comment）→ 2b61c15e（「既定と違う」の印）
- 全角数字を黙って捨てる（robustness）→ a0dbb9e2
- 戻した後も一覧が残る（robustness）→ 2b61c15e
- 同じパスのエンジンを差し替えても古い定義（robustness）→ 2b61c15e（取った日を出す）
- doc: 判定表の軸・冒頭の文、reducer の A/B、仕様の箇条の崩れ、計画と仕様の食い違い、消した `isLatestProbe` を指すテストのコメント（comment / architecture）→ 2b61c15e

## 送ったもの / 直さなかったもの

- 「アプリが決める」欄に、どの欄が決めるか（評価関数か解析の方針か）を出す案（architecture）: 名前から欄への対応を Rust の `ProbeOutcome.reserved` に理由付きで持たせる形になる。G3 で `binding` を触るときに一緒に見る
- 未保存の編集を Esc・外側のクリックで確認なしに捨てる（robustness。既存の挙動）: 欄が増えて失う量が増えた。直すなら閉じる前の確認で、ダイアログ全体の話なので別に

## 機械にできなかったもの

- 文言・見た目（`mechanization-backlog.md` の「機械では止まらないもの」1）。回数の書き戻しは無し

## 見ていない範囲

- 実機での見た目（40行の一覧、長い名前やパス）。`npm run build` は通した
- 実機のエンジンでの取得と保存
