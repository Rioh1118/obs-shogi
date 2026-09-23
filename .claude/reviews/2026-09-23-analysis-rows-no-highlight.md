# レビュー analysis-rows-no-highlight

- 日付: 2026-09-23
- 範囲: `git diff main...HEAD`（`MoveSequence.{tsx,scss}` / `CandidatesSection.tsx` / `docs/spec/screens/analysis-pane.md`）
- reviewer: architecture / comment / react / ui / oss-hygiene
- 対象コミット: d9c768a8

## 入れた機械

- `entities/analysis/model/__tests__/reducer.test.ts`「届いた順によらず rank の昇順に置く」。
  行モードは最善手を1行目にあることだけで示すようになったので、並びが唯一の印になった。
  `reducer.ts` の `sortByRank` を外すと落ちることを確かめた（9621c517）

## 直した所見

- 3155d12d `$marker-bar` のコメントが「選ばれている行」も左の帯の利用者に数えていた（実際は右の帯 `$marker-bar-end`）。main から既にあるずれ
- e121fec5 spec が表モードの最善の印を「帯」とだけ書いていた（実物は面・太さ・左の帯）
- dd2d5341 行モードで印を付けない理由が無かった。理由はユーザーに確認して書いた

## 送ったもの

なし

## 機械にできなかったもの

- 理由の欠落（comment）。書かれた理由の正しさは機械で判定できない

## 見ていない範囲

- 実際の描画（アプリを起動していない）
- `candidateCache` の控えが並びを保つか（`update_result` を通った `candidates` を控えるので保つはずだが、読んでいない）
