# レビュー engine-cross-cutting

- 日付: 2026-11-05
- 範囲: `origin/main`（20b74095）からの差分。エンジン周りの横断の整理（`docs/audits/2026-11-engine.md`、ADR-0015）
- 割り方: `src-tauri/` を `rust-reviewer`、`src/` を `react-reviewer`。`docs/` はメイン。2周目はメインが修正の差分だけを見た
- 対象コミット: `5ddb10fa` から `d0d6800a` までの9本

## 修正計画

| 順 | 場所 | ルール ID | 確信度 | 行き先 | 修正案 | 壊しうるもの |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `src-tauri/tests/layering.rs` の `wire_shapes_live_in_the_wire_shape_files` | R-新規 | 100 | 機械にする | rustfmt が折った `#[derive(` を `]` までつないで読む（`serde_derive_lines`） | 無し |
| 2 | 同 `the_types_layer_declares_no_trait` | R-新規 | 100 | 機械にする | `pub(crate)`、`pub(in …)`、`unsafe` を外してから `trait ` を見る（`trait_declarations`） | 無し |
| 3 | 同 `no_module_is_named_after_no_role` | R-新規 | 85 | 機械にする | ファイルの中の `mod x { … }` の名前も集める（`inline_module_names`） | `#[cfg(test)] mod tests` は先に落ちるので誤検出は無い |
| 4 | 同 `every_engine_file_says_what_it_hides` | R-新規 | 80 | 機械にする | 最初の `//!` 行が中身を持つことも見る（`says_what_it_hides`） | 無し |
| 5 | `src-tauri/src/engine/logging.rs` の冒頭 | R-新規 | 85 | 直す | 「上限はどれも予算から決まる」を、同じファイルの `LOG_FILE_BUDGET` の doc と合う形へ | 無し |
| 6 | `src/entities/engine-presets/index.ts` の冒頭 | R-新規 | 85 | 直す | 公開の基準を名前ごとでなくモジュールごとと書く | 無し |

1〜4 は同じ機構（形を読む走査が1つの書き方しか見ない）に集まったので、4つの読み方を純関数にして
`the_shape_scanners_read_every_spelling` で書き方の揺れを固定した。

## 入れた機械

- `the_shape_scanners_read_every_spelling`: 折った derive、可視性つきの trait と `unsafe trait`、中身の無い `//!`、
  ファイルの中の `mod`。derive をつながない形と `//!` の中身を見ない形に戻すと赤になることを確かめた

## 直した指摘（短ハッシュ）

1〜4 は `4f5102b3` への fixup、5 は `5ddb10fa` への fixup、6 は `5c8b784f` への fixup（`/organize-commits` で畳む）。

## 送ったもの（行き先の番号）

無し。
