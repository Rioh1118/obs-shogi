# レビュー engine-scope1-tail

- 日付: 2026-10-31 / 範囲: #172〜#366、#502〜#277、Codex の PR コメント / 割り方: 2本 / 対象: 各ブランチの先頭

## 修正計画

所見と扱いは PR #634 と #643 の本文に置いた。

## 入れた機械

- `the_engine_output_keeps_its_own_closing_parenthesis`、`an_overtaken_start_does_not_erase_the_new_position`、`a_start_that_could_not_be_written_says_so`
- `provider.test.tsx` の「▶ と語の食い違い」「開始がエンジンへ届かなかった回」
- `analysisControlsStatus.test.tsx` の語の開閉

## 送ったもの

- `shutdown_engine_impl` が `search_turn` を待った後に `is_superseded` を見直さない: 到達経路が作れず見送り。確信度80未満
- 再起動の窓で `syncedSfen` が古いまま `go` が出るか: 追い切れていない

## 見ていない範囲

`game/`、Windows の kill、窓のリサイズ時の面の位置。
