# レビュー store の分割 ラウンド5

- 日付: 2026-09-06
- 範囲: `a2fdbbb0..30dbd0ff` の2コミット
- 走らせた reviewer: architecture / comment
- 前ラウンド: `2026-09-05-store-split-r4.md`

**17 → 10 → 9 → 9 → 11件。**

**増えた。** r4 で足したラチェット `tests/search_doc_names.rs` に恒真の穴が集まっている
（R5-A / R5-B / R5-C）。**`index_cache_guard_names` を足したときと同じ形が再発した。**

## 所見

### HIGH

#### R5-A ラチェットに空振りを止める assert が無い。**バッククォート1個で恒真になる**

architecture / comment（両方）。`search_doc_names.rs:63-76`。

`quoted` は先頭から機械的にバッククォートを2つずつ対にする。
**doc のどこかにバッククォートが1個増えると、そこから先の対応が全部ずれる。**

**実測**（reviewer が抽出を再現）: いま候補は fn 名 23件 / 呼び出し 10件。
`## イベント` の直前にバッククォートを1つ足すと **0件 / 4件**。
`missing.is_empty()` しか見ていないので、**2本とも緑のまま何も見ない。**

この repo はこの穴を3箇所で明示的に塞いでいる
（`state_transition_cells.rs:250` / `index_cache_guard_names.rs:256` /
`ratchetIndex.test.ts:104`）。`scanning/mod.rs:19-21` が
「**見つからないことを黙って通さない**」と規約にしている。**新しい検査だけが持っていない。**

### MEDIUM

#### R5-B doc を壊しても緑になる形が4つ

architecture。`search_doc_names.rs:88-92,113-125,37-58`。

| 穴                           | 実測                                                                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 下線2つ以上の閾値            | **13個の fn が検査に載らない**（`decode_all` / `encode_all` / `try_restore` / `with_files` / `install_restored` / `open_project` など） |
| `..` を含むと両方から外れる  | **`install_restored(..)` は `U` 行の口なのに誰も見ていない**（r4 が同じセルの `with_state` を直したばかり）                             |
| 前方一致（`fn {q}`）         | 足す向きの改名は緑（`..._and_says_the_stage` など）                                                                                     |
| 文字列リテラルを潰していない | ログ文言に綴りがあれば恒真。`commands.rs:144` が実例                                                                                    |

閾値の理由に「型名を拾うと偽の赤」と書いたが、**型名は直前の `is_ascii_lowercase` で既に落ちている。**
実際に落としているのは `file_id` / `node_id` のような**欄の名前**。

`CONTRIBUTING.md:323` の「逃げ道: 無し」は事実でない。

#### R5-C `every_test_named_by_the_doc_exists` が見ているのは「テスト」ではない

comment。`search_doc_names.rs:83`。

**実測**: 候補の異なり14件のうち**テストは3件だけ**。残る11件は本番の関数
（`run_rescan_diff_apply` / `scan_kifu_files` / `read_to_jkf` / `is_occ_alive` など）。

#### R5-D 「`search.md` の表は形が違う」が事実でない

comment。`search_doc_names.rs:7-9`。

`search.md` にもセル表がある（`:60-70`）。載せられない本当の理由は
**遷移表にテスト列が無く、セルを名乗るテストも無いこと**（`search.md:300` が自分でそう書いている）。
**誤った理由を書くと次の一手が閉じる。**

#### R5-E `mod roots;` を宣言して使っていない

architecture / comment（両方）。`search_doc_names.rs:21`。

歩く根は `src/search` の直書き。`tests/roots/mod.rs:1-10` は
**「`src/` だけを見る検査を書かせない」ために置かれている**（ADR-0009）。
`#![allow(dead_code)]` があるので compiler も鳴らない。

#### R5-F `debug_assert` が、`search.md` 自身が「守りは無い」と書く競合で落ちる

architecture / comment（両方）。`build.rs:66-78`。

2度目の `open_project` が来ると、1本目が `with_files` を書き続けている最中に
2本目が spawn され、**`file_table.is_empty()` が偽で panic する。**
`JoinHandle` は捨てているので**誰にも回収されず、画面は `Building` のまま止まる。**

**門番が破れたときの症状が、doc の言う「静かな壊れ方」とほぼ同じ**になる。

#### R5-G `range_by_key` が `pub` のまま。閉じた3つの隣

architecture。`segment.rs:137`。

**実測**: 呼び手は定義・自身のテスト2件・`snapshot.rs:232` だけ。**bench も外も呼んでいない。**

`key_at` / `occ_at` を閉じた理由がそのまま当てはまる。**この棚卸しを人手でやって外したのは2回目。**

#### R5-H `fixtures` への集約が3箇所のうち1箇所しか当たっていない

architecture / comment（両方）。`snapshot.rs:398-412` / `segment.rs:173-179` / `compaction.rs:121`。

`snapshot.rs:250` は `use fixtures::*` を書いているのに、その下で同じものを手で組み直している。
`rg 'r#gen: 1' src/search/store` は `fixtures.rs` を除いて**3件**。

`segment.rs:173` の `fn occ(node_id)` は、`compaction.rs` が別名で入れている
`occ(file_id, node_id)` と**同じ名前で引数の意味が違う** —— **R4-I が落とした罠が別の場所に残った。**

`compaction.rs:121` の別名輸入で `alive_of` は**定義と import の2行にしか現れず**、
名前を検索して届く経路が無い。

#### R5-I 「欄を非公開にする道は使えない」の理由が bench だけになっている

comment。`index_store.rs:18-20`。

書いたとおり「bench 向けの口を1つ用意して欄を閉じる」と、**本番6箇所が落ちる**
（`query_service.rs:85,121-122` / `project_manager.rs:232` / `commands.rs:149` /
`index_cache.rs:181-182,306` / **この diff 自身が足した `build.rs:70,75`**）。

**r3-E と同じ着地に戻っている。**

#### R5-J `search.md:301` が、同じ段落の1本目と矛盾する

comment。

「3本とも出発点は空の索引」と書いたが、`restarting_the_store_throws_the_current_index_away` は
**中身を入れてから**始める。言いたいのは「**段**は `E` から動かしていない」。

#### R5-K `segment.rs` の「探している間のキャッシュを鍵の2列が占められる」に裏付けが無い

comment。`segment.rs:24-26`。

bench 10本にレイアウトを比べるものは無い。**repo 内に根拠が無い。**
（分割前の「binary search 中の L1 を z0/z1 が占有できる」の言い換え）

## 直す順

| 順  | 所見                                 | 理由                                                       |
| --- | ------------------------------------ | ---------------------------------------------------------- |
| 1   | **R5-A / R5-B / R5-C / R5-D / R5-E** | ラチェットを実効化する。恒真が最大                         |
| 2   | **R5-F**                             | 落ちたときの症状を実物に。release でも観測できるようにする |
| 3   | **R5-G / R5-H**                      | 棚卸しの取りこぼしと、集約の当て残し                       |
| 4   | **R5-I / R5-J / R5-K**               | doc の精度。**K は裏付けが無いので削る**                   |
