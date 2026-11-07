# レビュー readability-7a-session

- 日付: 2026-11-07
- 範囲: `src-tauri/src/engine/game/` の割り（`session.rs` → `stall.rs`、`start.rs`、`input.rs`、`fixtures.rs`）と、移った識別子を指すコメント・表
- 割り方: Rust は `rust-reviewer` 1本（fresh）。`docs/audits/`、`docs/readability-progress.md`、`CONTEXT.md` はメイン
- 対象コミット: `1aaf1a07`（基準 `origin/main` = `91d5f3b7`）

移した行が移動前と一致することは、メインが機械で確かめた。両方の本体を、行頭の空白と
`pub(super)` を落として並べ替えて比べ、差が `//!` の冒頭、`use`、`mod tests {` の枠だけであることを見た。
そのため、移した関数とコメントの中身はレビューの対象から外した。

## 修正計画

| 順 | ファイル:行 | ルール ID | 確信度 | 行き先 | 修正案 | 壊しうるもの |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `src-tauri/src/engine/game/search.rs:169` | R-新規（ファイルを指すコメントの定義元） | 80 | 直す。機械はバックログへ | 「`session.rs` の `on_tick`（判定は `stall.rs` の `stalled_turn`）」 | なし（コメント） |

## 入れた機械

なし。順1 の形は `comment_identifiers.rs` が識別子の実在だけを見るので素通りする。1件目なので
`.claude/knowledge/mechanization-backlog.md` の「入っていない。繰り返し提案されている」に回数1で載せた。

## 直した指摘（短ハッシュ）

- 順1: `f21fd164`（`fixup!`）

## 送ったもの（行き先の番号）

- `docs/decisions/0016-usi-machine-shell-procedures.md` の「`session.rs` の73本」は、基準のコミットの時点で既に81本と合っていなかった。ADR は書いた時点の記録なので直さない。U2b で `session.rs` のテストを数えるときに、今の数（`session.rs` 59本、`stall.rs` 6本、`start.rs` 5本、`input.rs` 11本）を見る

## 見ていない範囲

- 移した関数・定数・コメントの本文（機械で一致を確かめた）
- ワークスペース全体の `cargo test --workspace` は reviewer は走らせていない（メインが `npm run verify:rust` で通した）
