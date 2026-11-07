# レビュー usi-u2a-analyzer

- 日付: 2026-11-07
- 範囲: `src-tauri/src/engine/analyzer.rs`、`src-tauri/src/engine/protocol/search.rs`（差分の中だけ）。docs はメインが読んだ
- 割り方: `rust-reviewer` 1本（`src-tauri/` の2ファイル）＋メイン（docs と自己点検）。重（失敗経路・外部プロセス）
- 対象コミット: e4cbbbfa、dd472c17、045c02b4（レビュー時は b0db079d。修正の fixup を畳んだ）、459daa7e

## 修正計画

| 順 | ファイル:行 | ルール ID | 確信度 | 行き先 | 修正案 | 壊しうるもの |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `analyzer.rs` の `stop_analysis` | R-新規 | 80 | 機械にする | 止める頼みの送り手を探索の種類で分けない（`search_stop`）。`bridge` に `stopping_a_timed_analysis_writes_stop` | 探索が無いときの二重の `stop`（書かないので起きない） |
| 2 | `analyzer.rs` の `stop_infinite` の `Unreachable` | R-新規 | 85 | 機械にする | 止める頼みへは `Stopped` と答える。知らせは終わりの見張り。`bridge` に `an_engine_that_exits_on_stop_is_stopped` | 書けなかった回の `Err` が `Ok` になる（`Unwritable` は見張りが知らせる） |
| 3 | `analyzer.rs` の `result_of_stop` | 1 | 80 | 機械にする | 3つの経路の止めを `stop_search` に寄せ、上限切れは `unanswered` を立てて遅れた答えを待つ。`analyzer` に `a_timed_analysis_unanswered_at_its_stop_holds_back_the_next_go` | 時間と深度の検討の上限切れの後、遅れた答えまで次の `go` を断る |
| 4 | `analyzer.rs` の `AnalysisStreamItem::Finished` の doc | 1 | 85 | 直す | 止めた探索の `bestmove` は流れないと書き直す | 無し |

1〜3 は同じ機構（止める手順が経路ごとに分かれていた）なので、個別に直さず `stop_search` の1か所に落とした。

## 入れた機械

- `bridge` の `stopping_a_timed_analysis_writes_stop`: 時間を決めた検討を止める口で止められないと落ちる
- `bridge` の `an_engine_that_exits_on_stop_is_stopped`: 止めた後に終わるエンジンへの停止を失敗にすると落ちる
- `analyzer` の `a_timed_analysis_unanswered_at_its_stop_holds_back_the_next_go`: 時間の検討の止めの上限切れで印を立てないか、遅れた答えの後に下ろさないと落ちる
- `protocol/search.rs` の `a_late_answer_can_be_waited_for_and_holds_back_the_next_search`（レビュー前に足した）: `LateAnswer` が待たずに返るか、枠を返すと落ちる

3本のテストは、直す前の HEAD（b0db079d）で落ちることを確かめた。直した箇所の変異（届かない回を `Unanswered` と答える、遅れた答えの後に下ろさない）でも落ちる。

## 直した指摘（短ハッシュ）

1〜4 は 045c02b4 に畳み込み済み。

## 送ったもの（行き先の番号）

無し。

## 見ていない範囲

- `bridge.rs` は呼び手として読んだだけで、差分の外の振る舞いは見ていない
- 実アプリ（実物のエンジン）での開始と停止。台本のエンジンのテストだけ
- reviewer が窓が極小として外した2点: `start_analysis_engine_impl` と `stop_analysis` が `search_turn` の外で並ぶ回に、前のプロセスの流れが `unanswered` を立てるか。kill の後も孫プロセスが stdout を開けたままの回に、`LateAnswer::wait` が返らないか
