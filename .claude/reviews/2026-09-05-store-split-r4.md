# レビュー store の分割 ラウンド4

- 日付: 2026-09-06
- 範囲: `a78fa411..dfa4f61f` の2コミット（r3 の9件を直したぶん）
- 走らせた reviewer: architecture / comment
- 前ラウンド: `2026-09-05-store-split-r3.md`

**17 → 10 → 9 → 9件。**

**2件は、前のラウンドで直した誤りを私が別の場所に書き直したもの**（R4-B / R4-C）。
これがこのラウンドの主題。

## 所見

### HIGH

#### R4-A 全件構築が「空の `Building`」を前提にしたのに、それがどこにも書かれていない

architecture / comment（両方）。`build.rs:29`（doc が1行も無い）。

r3 で `with_state(Building)` を落としたので、このタスクは**呼ぶ直前に
`restart(Restart::Building)` が通っていること**に依存するようになった。
成り立っているのは呼び手が1つで、その20行上に `restart` があるからだけ。

**破れたときの壊れ方が重い。** `build.rs:52,85` は `file_id` を毎回 1 から振り直し
`gen` は常に 1。中身の残った索引に流すと、旧 `file_id` の出現が桶に残ったまま
`is_occ_alive(k, 1)` が真を返し、**新しい棋譜の節表で `cursor_lite` を引く** ——
押すと違う局面が出るヒットになる。`stale` も構築中ずっと `false` のまま。

#### R4-B `restored` の中のコメントが、r3-D で落とした誤りを1ファイル隣で復活させた

comment。`snapshot.rs:142`。

```rust
// 復元のあとは差分の取り込みが要るので、段は選ばせない
```

**r3-D で「復元のあとは必ず差分の取り込みが続く」に反例3つを出して落とした文**を、
同じ修正の中で `snapshot.rs` の関数本文に書き直した。

差分0（最頻の経路）では `run_rescan_diff_apply` は `with_files` を1回も呼ばずに戻る。
**「取り込みが要るから `Updating`」は最頻経路で成り立たない。**

同じ判断の理由がいま4箇所にあり、そのうち1つだけが誤っている。**r3-D と同型。**

#### R4-C `install_restored` の doc が、画面に無い文言と、r1-A5 で潰した因果を書いている

comment。`index_store.rs:60-63`。

**実測**: `rg 再スキャン` の一致は AI ライブラリとエンジン設定のボタン3件と、
**この doc 自身と `commands.rs:105` の写しだけ**。索引の段を出すバッジの文言は
`WorkspaceTab.tsx:18-43` の `準備完了 / 作成中 / 更新中 / 復元中`、
`stale` が出すのは `PositionSearchStatusBar.tsx:18` の「インデックス更新待ち」。

しかも**そのバッジは store の段を読んでいない**。画面へ届くのは
`query_service.rs:85` が作る `stale` の bool だけ ——
**`snapshot.rs:42-46` が正しく書いていることと直接矛盾する。**

**r1-A5（「`IndexState` は画面の出し分けに出る」は誤り）の再発。**

### MEDIUM

#### R4-D `fixtures.rs` の doc が逐語で二重、かつ「常に1件」に反例がある

architecture / comment（両方）。`fixtures.rs:1-5` と `:43-47`。

64行のファイルで同じ3行が2回。**R2-A（`compact_bucket_entries` の doc 二重）と同じ形。**

さらに「手で組むと桶の中身が**常に**1件になる」は偽 ——
`buckets[k.bucket()].push(..)` を2回書けば2件入る。

**逆に、`bucketize_entries` を通しても `one_file` は1鍵しか渡さないので桶は1件のまま。**
昇順の検査が効いているのは `file_with` に複数鍵を渡す1本だけ。

#### R4-E `IndexSnapshot` の欄が全部 `pub` で、私が書いた「残った穴」より短い穴がある

architecture。`snapshot.rs:70-76` / `index_store.rs:13-16`。

doc は穴の原因を `update` の戻り値型に帰しているが、実際は

```rust
update(|_| IndexSnapshot { state: IndexState::Ready, ..IndexSnapshot::default() })
```

が `with_state` を1度も通らずに書ける。**「`update` を絞れば塞がる」と読ませる。**

欄を非公開にする道も**使えない**。`benches/search_bench.rs:338` が構造体リテラルで組んでいる。
**この事実がどこにも書かれていない。**

#### R4-F `restarting` が `pub` のまま。`restored` と対なのに片方だけ閉じた

architecture。`snapshot.rs:100`。

**実測**: `restarting` / `key_at` / `occ_at` は `store/` の外に呼び手ゼロ。
`store.update(|_| IndexSnapshot::restarting(Restart::Building))` が書ける。

**r3 が `restored` に当てた修正が、同じ形の隣に当たっていない。**（**3ラウンド続けて同型**）

#### R4-G `fixtures.rs` が集約できていない

architecture。`compaction.rs:128-147` / `segment.rs:150-156` / `snapshot.rs:396-410`。

`store/` の `mod tests` は6つあるが `fixtures` を引くのは2つ。
同じ `FileEntry` リテラルが3箇所、`occ_of` と同じものが `compaction.rs` に別名である。

**素材の規約（`gen: 1`、`path` を `{file_id}.kif`）を変えたい人は4箇所を探す。**

#### R4-H `search.md` が挙げる3本のうち1本は段を1ビットも見ていない

comment。`search.md:293-297` / `index_store.rs:85-95`。

`restarting_the_store_throws_the_current_index_away` は**中身が捨てられることだけ**を見て
`state` を1つも assert しない。しかも3本とも出発点は `default()`（= `E`）で、
**表の矢印（`R`→`U`、`B`→`Y`、`U`→`Y`、`Y`→`U`）を1本も踏んでいない。**

#### R4-I `node_table_of` だけ引数の意味が並びと逆

comment。`fixtures.rs:35`。

`key_of(z0)` / `occ_of(file_id, ..)` / `entry_of(file_id)` は「x という値を持つもの」だが、
`node_table_of(nodes)` は「x **個**の節を持つもの」。

並びに合わせて `node_table_of(file_id)` と書くと、
**節の数が `file_id` 個の表が黙って出来る。** `store/` のテストは節数を assert しない。

## 実測で問題なしと判断したもの

- **`fixtures` というモジュール名は妥当。** `#[cfg(test)] mod fixtures;` + `pub(super)` で
  「`store/` の中からだけ」がコンパイラに強制されている
- **`RestoredCache` と `install_restored` の間に無駄は無い。** 6欄が索引側3欄と走査側3欄に
  きれいに割れており、`install_restored` がその3欄をそのまま受ける
- **`IndexState` の遷移規則を `store/` に置くべきではない。** `Restoring → Updating` と
  `Restoring → Building` の選択は `open_project` の復元成否で決まる**呼び手の順序**で、
  store の不変条件ではない。store の不変条件と言えるのは「`Building` は空から始まる」1つだけ
  （R4-A で扱う）

## 直す順

| 順  | 所見            | 理由                                                  |
| --- | --------------- | ----------------------------------------------------- |
| 1   | **R4-A**        | 壊れ方が重い。doc と `debug_assert`                   |
| 2   | **R4-B / R4-C** | 直した誤りの再発。**理由の写しを1つに減らす**         |
| 3   | **R4-F**        | `restarting` / `key_at` / `occ_at` を `pub(super)` に |
| 4   | **R4-E**        | 穴の原因を欄に帰し、bench が塞げない理由を書く        |
| 5   | **R4-G / R4-I** | 素材を寄せ、`node_table_with` に改名                  |
| 6   | **R4-D / R4-H** | doc の精度                                            |

## 機械に渡すもの

**`docs/state-transitions/search.md` を見るラチェットが無い。**
`tests/state_transition_cells.rs:70` が読むのは `game-session.md` **だけ**。

R2-D（`empty_with` が5箇所）・R3-A（`U` 行と `B` 行）・R4-H —— **同じ表の同じ腐りが
3ラウンド続けて人手で見つかっている。** CLAUDE.md は
「`docs/state-transitions/` は `verify:rust` まで通る」と書いているが、
**実際に見られているのは1ファイルだけ。**

このラウンドで足す。
