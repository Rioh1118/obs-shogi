# レビュー usi-u3-machine

- 日付: 2026-11-07
- 範囲: `src-tauri/src/engine/usi_machine.rs`、`usi_machine/declared.rs`、`protocol.rs`、`protocol/search.rs`（`rust-reviewer` 1本）。呼び手の変更（`analyzer.rs`、`game/`、`setup.rs`、`bridge.rs`、`registry.rs`、`types.rs`、`start_failure.rs`、`logging.rs`）、`tests/` の走査、docs はメインが読んだ
- 割り方: 範囲で2つ（状態機械と殻／それ以外）。重（外部プロセス・状態機械・失敗経路）
- 対象コミット: 70e0e93f、3b76cbf4（修正は fixup ca23ca88、259179d4、f942d452）

## 修正計画

| 順 | ファイル:行 | ルール ID | 確信度 | 行き先 | 修正案 | 壊しうるもの |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `protocol/search.rs` の `UsiProtocol::search` | R-新規（取り消しで持ち主の無い探索が残る） | 100 | 機械にする | `Search` を状態機械へ頼んだ直後に作り、書けたかを待つ間に捨てても `Drop` が `stop` を書く。`a_search_dropped_while_writing_does_not_hold_the_engine` で固定 | 書けなかった回も `Drop` を通る。閉じていなければ `stop` を書いて止め待ちになる（doc に書いた） |
| 2 | `protocol.rs` の `Shared::step`／手順 | R-新規（列で断っても後ろの書き込みは出る） | 100 | 機械にする | 手順が状態機械へ頼む前に、局面と `setoption` の欄を `refuse_breaking_field` で断る。`a_position_that_breaks_the_line_writes_nothing` で固定。列の `check_writable` は最後の砦として残す | `setoption` を組むのは状態機械だけ（`only_the_procedures_build_set_option`）のまま |
| 3 | `usi_machine.rs` の `identify`（Q5） | R-新規（コメントの条件と実装のずれ） | 100 | 機械にする | 名乗る前に閉じたら、待っていた名乗りと同じ断り（`unnamed_closed`）を返す。`identify_after_an_early_exit_says_it_ended_before_usiok` を閉じた理由3つで回す | 表の (Q5, R1) を同じ文に直した |
| 4 | `protocol/search.rs` の `PREVIOUS_SEARCH_LIMIT` | R-新規（関係を数字の写しで持つ） | 80 | 機械にする | `game/search.rs` の `waiting_for_the_previous_search_outlasts_a_stop` で `>= SEARCH_STOP_GRACE * 2` を固定し、doc は出典を綴りで指す | 無し |
| 5 | `analyzer.rs` の `stop_search`、`game/search.rs` の `StopTimedOut` と `run_search`、`bridge.rs` の2か所、`game-session.md` の不変条件2 | 機械では止まらないもの1（コメントの条件と実装のずれ） | 90 | 直す | 「`LateAnswer` が探索の枠を握る／捨てると枠が返る」「積み置きが満杯」を、状態機械の止め待ちが断る形に書き直す | 無し（doc） |
| 6 | `protocol/search.rs` の `search` の doc（2周目） | 同上 | 85 | 直す | 「書けない回は閉じている」を、閉じていない回は `stop` を書くと直す | 無し（doc） |

## 入れた機械

- `a_search_dropped_while_writing_does_not_hold_the_engine`: `Search` を書き込みの後に作る形に戻す変異で落ちる
- `a_position_that_breaks_the_line_writes_nothing`: 局面の事前の検査を外す変異で落ちる
- `identify_after_an_early_exit_says_it_ended_before_usiok`（3つの理由）: kill の後を `closed_error` に戻す変異で落ちる
- `waiting_for_the_previous_search_outlasts_a_stop`: 2つの上限の関係を式で持つ

## 直した指摘（短ハッシュ）

1〜4 は 259179d4、5 は ca23ca88、6 は f942d452（どれも 70e0e93f への fixup）。

## 送ったもの（行き先の番号）

- 無し

## 見ていない範囲

- 呼び手が `check_value` と `prepare`、`identify` と `check_value` を並行に呼ぶ経路（呼ぶ呼び手は無い。表の (Q2c, L4) は「—」で、Q2c が抱えた準備の札は `readyok` で答えない）
- `child.rs`、`option_line.rs` の中身
- 実アプリ（実物のエンジン）での検討と対局
