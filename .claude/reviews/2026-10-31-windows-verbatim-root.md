# レビュー windows-verbatim-root

- 日付: 2026-10-31
- 範囲: PR #628（`plain_spelling`、`walk_from`、`scan_kifu_files`、`CACHE_VERSION`、CI の `windows-tests`）
- 割り方: メイン1本
- 対象コミット: `fix/windows-verbatim-root`

## 修正計画

指摘なし。確かめた壊れうる箇所:

| 箇所 | 結果 |
| --- | --- |
| `walk_from` の `canonical_root` / `followed` | `fs::canonicalize` の結果と比べるので解決後のまま残した |
| 検索ヒットとツリーの突き合わせ | 両方を `plain_spelling` に通し、テストで一致を固定した |
| 保存済みの索引 | 古い綴りの鍵が残るので `CACHE_VERSION` を上げた。全 OS で一度作り直しになる |
| `validate_under_root` / `is_project_root` | 両辺を canonicalize するので影響なし |
| macOS / Linux | `dunce::simplified` は素通し |

## 入れた機械

- CI の `Tests on Windows`。`plain_spelling_is_shared_by_the_tree_and_the_search` を Windows で実行する
- 修正前の赤を実機で確認した: `\\?\C:\Users\runneradmin\...\a.kif`（run 41180712229）

## 直した指摘（短ハッシュ）

なし。

## 送ったもの（行き先の番号）

- root の解決でパスが別の場所へ移る場合（symlink、割り当てたドライブ、UNC）は綴りの差が残る。別 Issue へ送る

## 見ていない範囲

- 実アプリの画面操作（Windows 実機が手元に無い）
- `quality` 以外の Rust テストの Windows 実行（名指しの1本だけを走らせる）
