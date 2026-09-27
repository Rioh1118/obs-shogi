# レビュー engine-candidates

- 日付: 2026-09-27
- 範囲: `feat/engine-filter`（origin/main 4b118aeb からの差分。PR E: プリセット編集のエンジンを名前で絞らず、起動できない見込みの理由を添えて並べる。#492）
- 走らせた reviewer: architecture / react / comment（中の重さ。1スライス内、失敗経路・外部プロセスに触れない）
- 対象コミット: 未コミットの作業ツリーを見た。直しは本体と同じコミットに入っている

## 入れた機械

- `presetEngineOptions.test.ts`: 名前で絞らない（YaneuraOu 以外・1段下のフォルダ）／理由を添えて並べ、別の OS 向け・読めないものは選べない（名前や見込みで絞る変異、`isEngineForThisMachine` を外す変異で落ちる）
- `presetDialog.test.ts`: エンジンの自動補完は選べる候補がちょうど1つのときだけ（`>= 1` にする変異、選べないものも数える変異で落ちる）
- 2巡目: 改名の後に同じ変異を当て直して落ちることを確かめた

## 直した所見

- `LAUNCHABILITY_NOTE` の doc が AI ライブラリタブについて逆のことを書いていた（architecture / comment。HIGH）
- 「どのエンジンでも評価関数・定跡は届く」は言い過ぎ → 「流し先は実行ファイル名でなく申告から決まる」（architecture / comment）
- 「起動の失敗の帯が理由を言う」は `notExecutable` には当たらない → 「確かめる場所を言う」。理由の出典を `isEngineForThisMachine` の doc の1か所に（comment / architecture）
- `isEngineForThisMachine` の doc が「プリセットの候補はこれで決める」のまま（architecture / comment）
- 欄の説明「ファイルが候補」→「実行ファイル」（architecture / comment）
- `engineFilter.ts` → `presetEngineOptions.ts`（何も絞っていない。architecture / react）

## 送ったもの

- #492 のずれは向きを変えて残る（AI ライブラリタブは別の OS 向け・読めないものを理由を言わずに数えから外す）: `docs/spec/screens/settings.md` の「いま満たしていないこと」に書いた。直すなら AI ライブラリタブで `LAUNCHABILITY_NOTE` を使う（architecture の案 b）

## 機械にできなかったもの

- 所見は全部、別の画面や別のファイルの振る舞いについての文の正しさ（`mechanization-backlog.md` の「機械では止まらないもの」1・4）。回数の書き戻しは無し

## 見ていない範囲

- 実機（V8.30 / V9.00 / zermelo）を置いてダイアログで選び、起動すること（計画の手動受入）
- `ui-reviewer`（見た目は select の文言だけ）
