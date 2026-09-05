# レビュー store の分割 ラウンド2

- 日付: 2026-09-06
- 範囲: `0377470b..f98170ce` の5コミット（r1 の17件を直したぶん）
- 走らせた reviewer: architecture / comment
- 前ラウンド: `2026-09-05-store-split-r1.md`

**17 → 10件。** うち **2件は BLOCK で、私の編集ミス**（doc の重複と、doc がヘルパに付いた件）。

**r1 で「直した」と報告したものが、直しきれていないものが4件。**

## 所見

### BLOCK

#### R2-A `compact_bucket_entries` の doc が二重で、戻り値の型と矛盾している

architecture / comment（両方）。`compaction.rs:66-84`。

**分割前の doc を消さずに新しい doc を継ぎ足した。** 同じ3段落がほぼ逐語で2回並び
（違いは「検索側」/「引く側」の1語だけ）、先頭の1文は

> 1本のセグメントを返す。1件も残らなければ `None`。

だが、この関数は `Vec<(PositionKey, Occurrence)>` を返す。**`None` を返す口が無い。**

`comment_identifiers` の「要約が2つ並ぶ」検査は `#[test]` の doc しか見ないので素通りした。

#### R2-B テストの doc がヘルパに付き、名乗り先のテストが裸になった

architecture / comment（両方）。`snapshot.rs:251-258` / `:403-404`。

`31ccc971` で既存の doc と既存のテストの間にヘルパ5つを挿し込んだ結果、

> 題材は `file_id` の降順で詰める —— 昇順で詰めると、並べ替えを消しても偶然通る。

が `key_of`（`PositionKey` を返すだけ）の doc になった。
**降順で詰めている理由が、テストの近くに1文も無い。**

次に触る人が「意味の無い書き方」と見て昇順に揃えると、
**`sort_unstable_by_key` を消す変異が緑で通るようになる。**

### HIGH

#### R2-C `IndexStore` の口は絞れていない

architecture / comment（両方）。`index_store.rs:10-12`。

doc は「置ける形は `restart` と `install_restored` の2つだけ」と書くが、**3つある。**

| 口                 | 「空にして `Ready`」が書けるか                                         |
| ------------------ | ---------------------------------------------------------------------- |
| `restart`          | **書けない**（`Restart` の2つに絞った）                                |
| `install_restored` | **書ける**。`state` を素の `IndexState` で受ける                       |
| `update`           | **書ける**。`update(\|_\| IndexSnapshot::default().with_state(Ready))` |

**`Restart` を作った理由が、隣のメソッドでは適用されていない。**

`install_restored` の呼び手は `commands.rs:107` の1箇所だけで、渡すのは常に `Updating`。

#### R2-D `search.md` が、どこにも無い `empty_with` を5箇所で指している

architecture / comment（両方）。`search.md:21,22,26,98,290`。

**実測**: `rg empty_with` の一致は**この doc の5行だけ**。`replace` も `IndexStore` の外から呼べない。

`735360f1` は同じ doc の事実誤りを直すコミットでありながら、**`:15` の1行しか直していない。**

さらに **`B` 行の判定条件が実装と食い違う**。`Building` を置く経路は2つあり、
`commands.rs:176` の `restart`（空にする）と `build.rs:65` の `with_state`（中身を残す）。

#### R2-E `compaction.rs` の「しきい値を超えた桶だけ」に、この diff 自身が反例を作った

architecture / comment（両方）。`compaction.rs:3-8`。

`1ad24959` でキャッシュ側の写しを消してこのモジュールへ寄せた結果、
**`cache/index_cache.rs:305` の `compact_all_buckets` が保存のたびに 256 桶を無条件で畳む。**

畳む呼び手は2つ —— `with_files`（しきい値超えの桶だけ）と `compact_all_buckets`（全桶）。

#### R2-F `new_sorted` の「作る側は2つ」が復元経路を落としている

comment。`segment.rs:25-26`。

本番の呼び出しは**3箇所**（`snapshot.rs:138` の `restored` / `:172` の `with_files` /
`compaction.rs:122`）。`restored` の素材は `decode_all` が読んだ並びがそのまま渡る。

**昇順の責任者を数え上げる doc が、3人のうち1人を落としている。**
`decode_all` の並び検査を「冗長だ」と外す人が最初に読むのがここ。

### MEDIUM

#### R2-G `Segment::from_soa` が呼び手ゼロで、`debug_assert` を迂回する第2の扉

architecture。`segment.rs:61-79`。

**実測**: `rg from_soa` は定義1行のみ。唯一の呼び手だった旧 `compact_bucket` を
この diff が書き換えた。`lib.rs` が `pub mod search` なので `dead_code` は鳴らない。

**列を直接渡せば昇順の検査を1つも通らずに `Segment` が作れる。**

#### R2-H 新しいテストの桶が `bucketize_entries` を通らない

architecture（私も独立に気づいた）。`snapshot.rs:287-292`。

`one_file` は `empty_buckets()` に直接 push するので**桶の中身が常に1件**。
`new_sorted` に足した `debug_assert` も `range_by_key` の二分探索も、
**新しい4本では一度も効いていない。**

`bucketize_entries` の `sort_by_key` を消す変異を入れても、この4本は全部緑。

#### R2-I `restarting_throws_the_index_away` が同語反復

architecture / comment（両方）。`snapshot.rs:389-401`。

期待値の `at.into()` が、テスト対象と**同じ `From<Restart>`** を通る。
**その impl の2本の腕を入れ替えても両辺が同時に動くので緑。**

`:393` の `let _ =` は結果を捨てているだけで、名前が言う「捨てる」を1ビットも見ていない
（`restarting` は `&self` を取らない）。

#### R2-J `index_cache.rs` に腐った参照が3箇所

architecture。`:1281` `:1409` `:1892`。

`compact_bucket` の k-way マージを持つのは `compact_bucket_entries` に移り、
`index_store` が `key.bucket()` の桶しか見ない判断は `snapshot.rs` に移った。
**綴りは crate に残っているので `comment_identifiers` が素通りする。**

## 実測で問題なしと判断したもの

- **`pub(in crate::search)` の可視性は正しい向き。** `cache/` は元から
  `store::bucket` / `file_table` / `node_table` / `snapshot` を引いており、
  向きは `cache → store` の下向きのまま。**畳み方の知識を `cache/` が持たなくなった**
- **`compact_bucket_entries` と `compact_bucket` の2段は妥当。** 前者は blob に書く
  素材が要る `cache/` 向け、後者は `Segment` と `None` が要る `with_files` 向け
- **`debug_assert` で release と debug は割れない。** 外から来るのは `restored` だけで、
  `index_cache.rs:707-709` が **release でも**同じ条件で弾いてキャッシュごと捨てる
- **`SnapshotCell::new` の「本番は `Default` を通る」は正しい**（`lib.rs:40`）
- **`Restart` / `restarting` の命名に齟齬は無い**

## 直す順

| 順  | 所見                   | 理由                                                   |
| --- | ---------------------- | ------------------------------------------------------ |
| 1   | **R2-A / R2-B**        | BLOCK。私の編集ミス                                    |
| 2   | **R2-C**               | `install_restored` から `state` を落とす。doc を事実に |
| 3   | **R2-G**               | `from_soa` を消す。扉を1つにする                       |
| 4   | **R2-H / R2-I**        | テストが本番の口を通り、同語反復をやめる               |
| 5   | **R2-D**               | `search.md` の5箇所。`build.rs:65` の冗長も落とす      |
| 6   | **R2-E / R2-F / R2-J** | doc の精度                                             |
