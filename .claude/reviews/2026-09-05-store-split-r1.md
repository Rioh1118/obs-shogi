# レビュー store の分割 ラウンド1

- 日付: 2026-09-05
- 範囲: `88418f5e..d1692e5c` の4コミット（`search/store/` の再構成）
- 走らせた reviewer: architecture / comment

**17件**（architecture 7・comment 12、重複2件を畳んだ）。

**うち5件は、この分割で私が新しく書いた散文の事実誤り。** 全部「他のモジュールの
振る舞いを断定した」形で、search-contracts のレビューで11ラウンド続けて外した形と同じ。

## 事実誤り（すべて実測で確定）

| #      | 書いたこと                                                    | 実物                                                                                                                 |
| ------ | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **A1** | 「読みはロックを取らない」「読み手は待たない」                | `snapshot()` は `RwLock::read()` を取る。`update` の `f` が走る間**待つ**                                            |
| **A2** | `NodeTables` の `None` は「削除された棋譜、読めなかった棋譜」 | どちらも `Some`。`with_tombstone` は節表を持ち越し、読めなかった棋譜は `NodeTable::empty()` を積む                   |
| **A3** | `file_id` は「0 から振る」                                    | **1 起点**（`build.rs:52,87` の `(i as u32) + 1`）。slot 0 は未使用。隣の `file_table.rs:3-5` が正しく書いている     |
| **A4** | 「穴が空くから出現ゼロの節表が blob に載る」                  | `encode_all` は `if let Some(nt)` で**穴を1件も書かない**。原因は `with_tombstone` の持ち越しと `NodeTable::empty()` |
| **A5** | `IndexState` は「画面の出し分けに出る」                       | `Serialize` が無い。画面へ出るのは `types::IndexState`（別型・同名）。ここから届くのは `stale` の bool 1つ           |

**A1 は BLOCK。** 実際の経路がある。`build.rs:160` が 64件ごとに `update` を呼び、
その中で `compact_bucket` が桶を全件舐める。その間 `query_service.rs:84` の
`snapshot()` はブロックする。**doc を信じた人は原因を別の場所に探す。**

## 設計の所見

### R1-B `compact_bucket` が2つあり、同じ鍵の尾が違う

architecture。`store/compaction.rs:56` / `cache/index_cache.rs:339`。

```
store  (key, seg, idx)                  ← セグメントの並び順に依存
cache  (key, occ.file_id, occ.node_id)  ← 内容で決まる
```

どちらも「桶を合流して `is_occ_alive` で生存だけ残す」を手書き。
**`compaction.rs` の「畳む方針が変わるときだけこのファイルが変わる」は成り立っていない。**

`HeapItem` も crate 全体ではまだ2つ（`compaction.rs` の `KeyHead` と `index_cache.rs:305`）。

### R1-C `replace` が汎用の扉になり、「空にして `Ready`」が1式で書ける

architecture。`snapshot_cell.rs:42` / `snapshot.rs:62`。

変更前、中身を捨てる2つ（`start_restoring` / `start_full_build`）は**状態が
ハードコードされていた**ので「空にして `Ready`」は型として書けなかった。

いまは `store.replace(IndexSnapshot::empty_with(Ready))` が通る。そうすると
`query_service.rs:85` が `stale=false` を返し、**空の結果が「新鮮で正しい」として
画面に出る**。エラーもログも出ない。

**畳む判断（`empty_with`）が、畳む先を `IndexState` 全体に開いた。**

### R1-D 純関数にした遷移にテストが0本

architecture。ロックから外した唯一の見返りを取っていない。
`with_files` / `with_tombstone` / `restored` / `empty_with` を通るテストは無く、
`compaction.rs` に `mod tests` そのものが無い。

**`with_tombstone` が誤って `buckets` を空にする変異を入れても緑のまま通る。**

### R1-E `Segment::new_sorted` の前提の保証者が、2つの呼び口の片方でしか名指しされていない

architecture。`restored` は `decode_all` を名指しするが、`with_files` は何も言わない。
`FileBucketEntries` は素の tuple エイリアスで、**型は昇順を1ビットも表していない。**
守っているのは `bucketize_entries` だけで、そのことがどこにも書かれていない。

### R1-F 移設で腐った参照が7箇所

architecture / comment（重複あり）。

`bucket.rs:4,6` / `segment.rs:171` / `position_key.rs:36` / `index_cache.rs:1482` /
`project_manager.rs:312` / `search.md:15`。

**`project_manager.rs:312` の `insert_many_file_segments` は crate のどこにも無い名前。**
ラチェットはバッククォート付きの識別子しか見ないので素通りした。

### R1-G 「このファイルだけが変わる」が互いに反例になっている

comment / architecture。

`compaction.rs:7`「畳む方針が変わるときだけ」と `snapshot.rs:7`「索引に何が入るかが
変わるときだけ」。だが**畳むかどうかの判断は `snapshot.rs:140`** にあり、
検索の並びの規約は `snapshot.rs` で変わった（`aceb3a12`。索引に入るものは1ビットも
変わっていない）。**どちらを開いても方針の在処に辿り着けない。**

### R1-H 「どの欄も `Arc` で共有する」が `buckets` に当てはまらない

comment。`buckets` は `[Vec<SegmentArc>; 256]` で、**欄そのものは `Arc` の中に無い。**
`with_state` は遷移のたびに 256 本の `Vec` を作り直す。`with_tombstone` も削除1件ごと
（`project_manager.rs:200` はループの中）。

### R1-I その他

- **`IndexState` が2つあり、呼び手4ファイル全員が `as StoreIndexState` と別名を付けている**（comment）
- **`with_files` だけ `with_*` の語法から外れている**（積み増しであって置換でない）（comment）
- **「節表を消しても得が無い」が `search.md:268` と食い違う**（持ち越しには代償がある）（comment）
- **`pub fn new` に doc が無く、本番の呼び手も無い**（comment）
- **`index_store.rs` が中身を持たず、他2モジュールの説明だけを置いている**（comment）

## 実測で問題なしと判断したもの

- **`SnapshotCell<T>` を trait でなく型引数にした判断は正しい。** 器は `T` の
  メソッドを1つも呼ばない。2つ目の実装があるとすれば `RwLock` → `ArcSwap` だが、
  それは `T` でなく器の内部の話なので trait では逆転させられない
- **検索側のヒープを捨てた判断は正しい。** 旧実装は同じ鍵の区間内を並べ替えて
  いなかったので、合流では順序を作れていなかった
- **`store/` の中に上向きの依存は無い。** 循環は `bucket.rs` ↔ `segment.rs` の
  テスト側の片道が1つあるが、**この変更が作ったものではない**
- **`restored` が名指しする `decode_all` の桶の検査は実在する**（`index_cache.rs:707-709`）
- **`compaction.rs` の `>` 比較と doc の「超えたら」は一致している**

## 直す順

| 順  | 所見                   | 理由                                                               |
| --- | ---------------------- | ------------------------------------------------------------------ |
| 1   | **A1〜A5**             | 事実誤り。読み手を誤らせる度合いが最大                             |
| 2   | **R1-C**               | 型で塞ぐ。私が開けた穴                                             |
| 3   | **R1-B**               | `compact_bucket` を1本に。尾は内容で決まる方（`cache` 側）へ揃える |
| 4   | **R1-D**               | 遷移のテスト3本。**変異で落ちることを確かめる**                    |
| 5   | **R1-E**               | `new_sorted` に `debug_assert`、`with_files` に保証者を書く        |
| 6   | **R1-F**               | 腐った参照7箇所                                                    |
| 7   | **R1-G / R1-H / R1-I** | doc の精度                                                         |

**3 は範囲が `cache/` に及ぶ。** `/implement` 手順7 では「範囲の中にあり独立して直せる」に
当たるので別コミットにする。
