# レビュー readability-8a-analyzer

- 日付: 2026-11-07
- 範囲: `origin/main`（5682398e）から `refactor/readability-8a-analyzer` の差分
- 割り方: `src-tauri/` を `rust-reviewer` 1本、`src/` と `docs/` はメインが見る
- 対象コミット: 8e4f2a56..b8c42278

## 修正計画

確信度80以上の所見は無かった。直すものは無い。

reviewer が挙げた振る舞いの差（どちらも競合の順序でだけ起きる。悪くなる順序は見つからなかった）:

- `analyze_with_time_impl` / `analyze_with_depth_impl` は `search_turn` を取らない。`start_search` が `protocol()` を通った後、`state.read` を読む前に `shutdown` の `take_over` が割り込むと、旧実装は落ちかけのプロセスへ `position` と `go` を書きに行っていた。新しい実装は局面が消えているので `InvalidState` で返る
- `started_by`: 起動 A の `publish` から旧 `bridge` の書き込みまでの間に起動 B が割り込むと、旧実装は B が動いているのに A の番号を名乗った。新しい実装は B の番号のまま

## 入れた機械

- `tests/layering.rs` の段 `analysis_start`。起動の手順が `analyzer`（世代、`unanswered`）を使う形を落とす
- テスト `started_by_names_the_request_that_started_the_running_engine`。変異2本（書き込みを外す、世代を書く）で落ちる。`latest_request` を返す変異は同値（`engine_id` が空の間しか違わない）

## 直した指摘（短ハッシュ）

無し。

## 送ったもの（行き先の番号）

- D-3（`bridge` が組む断りの文と `superseded_request` の重複）は範囲8b のまま

## 見ていない範囲

- `bridge.rs` の `started_by` 以外（範囲8b）
- `analysis_start::start` から呼ぶ `setup` / `binding` / `registry` の中身（写しただけで、変えていない）
- 実プロセスを使う経路を、実アプリで通していない
