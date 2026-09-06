# レビュー store の分割 ラウンド3

- 日付: 2026-09-06
- 範囲: `895ca8ca..097f4a89` の3コミット（r2 の10件を直したぶん）
- 走らせた reviewer: architecture / comment
- 前ラウンド: `2026-09-05-store-split-r2.md`

**17 → 10 → 9件。**

**r2 で「塞いだ」と報告した穴が、1段下に移っただけだった**（R3-B）。これが今回いちばん重い。

## 所見

### R3-A `search.md` の `U` 行と `B` 行が、どちらも実装と合っていない

architecture / comment（両方）。`search.md:22-23` / `build.rs:65`。

**`U` 行**: `replace(restored(Updating, ..))` と書いてあるが、`710c24c5` で
`install_restored` から `state` を落としたので、**その式は `index_store.rs:64` の中にしか無い。**
`replace` は器の非公開欄に対するメソッドで、`store/` の外から呼ぶ経路が無い。
**`U` に入る本番の口（`install_restored`）が表のどこにも出てこない。**

r2 は `R` / `B` 行を直して `U` 行を見落とした。**R2-D と同じ形が同じ表に1行残った。**

**`B` 行**: `Building` を置く口は2つあり、`restart`（空にする）と
`build.rs:65` の `with_state`（**中身を残す**）。表は前者しか書いていない。

いま空が保たれているのは `build_full_index_task` の呼び手が1つで、
その直前が `restart` だから。**「B ⇒ 空」を守っているのは呼び手が1つであることだけ。**

### R3-B `IndexSnapshot::restored` が `pub` のまま `state` を受けている

architecture。`snapshot.rs:127-132`。

`state` に渡る値は crate 全体で `Updating` の1つだけ。**引数の取りうる値が1つしかない。**

そのうえ `restored` は `pub` で、`FileTable::default()` も `NodeTables::default()` も
`empty_buckets()` も `pub` なので、

```rust
store.update(|_| IndexSnapshot::restored(Ready, FileTable::default(), NodeTables::default(), empty_buckets()))
```

が今日そのまま書ける。**R1-C と同じ結末（空にして `Ready`）へ、より短い扉が1本ある。**

**`install_restored` から `state` を落とした修正は、決め打ちを1段下へ移しただけで扉を閉じていない。**

### R3-C `pub` で呼び手ゼロが1つ残っている

architecture（**指摘の半分は誤り**）。`node_table.rs:114` の `len_nodes`。

reviewer は `iter_entries` も挙げたが、**`benches/search_bench.rs:498,622` が使っている。**
呼び手ゼロは `len_nodes` だけ。

**`store/mod.rs` を `pub(in crate::search)` にする案は採れない。**
bench は外部クレートで、`app_lib::search::store::{bucket, file_table, node_table, segment, snapshot}`
の5つを import している（`search_bench.rs:30-34`）。

### R3-D 「復元のあとは必ず差分の取り込みが続く」に反例が3つ

architecture / comment（両方）。`index_store.rs:56-57`。

`run_rescan_diff_apply` は3経路で取り込みを1件もしない ——
差分0（`project_manager.rs:176`）、`root_dir` が `None`（`:150`）、走査が `Err`（`:159`）。

**差分0 は起動時のいちばん普通の経路**で、`search.md:71-75` 自身が
「差分が0でも `with_state(Ready)` を無条件で呼ぶ」と書いている。
**「必ず続く」は最頻の経路で成り立たない。**

段を `Updating` に決め打つ本当の理由は `commands.rs:104-106`
（`Ready` を先に出すと `stale=false` の結果が古い snapshot を見る）にあり、
**同じ判断の理由が2箇所にあって、store 側の写しだけが誤っている。**

### R3-E `index_store.rs` の doc が挙げる「塞ぎ方」では塞がらない

comment。`index_store.rs:16`。

「型で塞ぐには `IndexSnapshot` の欄を非公開にするところまで要る」と書いたが、
**欄を非公開にしても、doc が挙げているその式はそのままコンパイルできる**
（`default()` も `with_state` も欄に触らない `pub` の口）。

しかも非公開にすると `query_service.rs:85,121-122` / `project_manager.rs:232` /
`index_cache.rs:181-182,306` が読めなくなる。

**この指示に従った人は「本番を5箇所壊して、穴はそのまま」に着地する。**

### R3-F `compaction.rs` の表が、キャッシュ側にも選択があるように読める

architecture。`compaction.rs:6-11`。

2つの呼び手を「いつ」の欄で並べると、**キャッシュ側もしきい値を選べるのに選んでいない**ように読める。

実際は選べない。blob は桶ごとに1本の昇順で書く形式で、`encode_all` が
`refusing to write: bucket {b} is not sorted` を返して**書くのを拒む**。
ここにしきい値を持ち込むと `save_checkpoint` が毎回 `Err` で終わり、
**キャッシュが一度も書かれず毎起動で全件構築**になる（`build.rs:224` は `let _ =` で捨てるので画面に出ない）。

### R3-G `IndexStore` を通るテストが `snapshot.rs` にある

architecture。`snapshot.rs:439-453`。

`store/` の向きは `index_store → snapshot → {bucket, compaction, segment}` の下向きで、
`snapshot.rs` は `index_store` を `use` していない。
**このテストだけが逆向きに引いている**（`super::*` で届かずフルパスを書いているのが徴候）。

`index_store.rs` に `#[test]` は0本。口を触る人はそこを開いて「器のテストは無い」と読む。

### R3-H `search.md` の「状態機械を回すテストは無い」に、この範囲で足したテストが反例

comment。`search.md:293-294`。

`snapshot.rs:443` は `IndexStore` を作って中身を入れ、`restart` を通し、中身が消えることを見ている
—— 表 `:26` の「`R` と `B` は中身を捨てる」そのもの。

### R3-I `Segment::is_empty` から `#[inline]` が消えた

architecture（併記）。`segment.rs:62`。**`from_soa` の削除に巻き込まれた。**
`len` / `occ_at` / `key_at` は `#[inline]` のまま。

## 実測で問題なしと判断したもの

- **`install_restored` から `state` を落としても遷移は変わらない。**
  `Updating` → 差分反映 → `Ready` で、emit する payload の段とも一致
- **`compaction.rs` の「チェックポイントを書くたび、全桶」は正しい。**
  `compact_bucket_entries` の本番の呼び手は `index_cache.rs:306` の1つ、
  その唯一の呼び手が `save_checkpoint`。`std::array::from_fn` なので全 256 桶
- **`segment.rs` の「昇順を作る側は3つ」「`decode_all` が release でも弾く」は正しい**
- **`several_keys_in_one_bucket_are_ordered_by_the_maker` の doc は記述どおり**
- **保存の重さは妥当。** `save_checkpoint` の呼び手は `build.rs:224` の1つだけ（全件構築の末尾）で、
  `encode_all` が同じ生存出現を全件舐めるので、合流の追加分は `log(セグメント本数)` 倍の比較にとどまる
  （**実測はしていない**）

## 直す順

| 順  | 所見            | 理由                                                  |
| --- | --------------- | ----------------------------------------------------- |
| 1   | **R3-B**        | 扉を閉じる。r2 で閉じたつもりが移っただけだった       |
| 2   | **R3-A**        | `build.rs:65` を落として口を1本に。表の `U` / `B` 行  |
| 3   | **R3-D / R3-E** | 私が書いた断定と、効かない塞ぎ方                      |
| 4   | **R3-G**        | テストを器の側へ。素材は `store/fixtures.rs` へ下げる |
| 5   | **R3-C / R3-I** | `len_nodes` を消す。`#[inline]` を戻す                |
| 6   | **R3-F / R3-H** | doc の精度                                            |

## 結果（r3 の修正）

**9件すべて直した。1コミット**（`8debc507`。同じ扉と同じテスト群を触るため分けられなかった）。

| 所見     | 直し方                                                                |
| -------- | --------------------------------------------------------------------- |
| **R3-A** | `build.rs:65` を落として `Building` の口を1つに。`U` / `B` 行を実装に |
| **R3-B** | `restored` から `state` を落として `pub(super)`。**扉が閉じた**       |
| **R3-C** | `len_nodes` を削除。`iter_entries` は bench が使うので残す            |
| **R3-D** | 「必ず続く」を落とし、**呼び手の義務**として書く                      |
| **R3-E** | 効かない塞ぎ方を落とす                                                |
| **R3-F** | キャッシュ側に選ぶ余地が無い理由を欄に                                |
| **R3-G** | 器のテストを `index_store.rs` へ。素材を `store/fixtures.rs` へ下げる |
| **R3-H** | 段の遷移を固定しているテストを名指し                                  |
| **R3-I** | `#[inline]` を戻す                                                    |

### 扉が閉じたことをコンパイルで確かめた

`store/` の外（`query_service.rs`）から `IndexSnapshot::restored(...)` を呼ぶと

```
error[E0624]: associated function `restored` is private
```

### 変異

| 変異                               | 結果                                                                  |
| ---------------------------------- | --------------------------------------------------------------------- |
| `restored` が `Ready` を置く       | **落ちる**（新しい `an_installed_restore_says_it_is_still_updating`） |
| `restart` を `update` にすり替える | **落ちる**                                                            |

### reviewer の指摘に1件の誤りがあった

「`iter_entries` は呼び手ゼロ」は誤り。**`benches/search_bench.rs:498,622` が使っている。**

reviewer が併せて出した「`store/mod.rs` を `pub(in crate::search)` にすれば
`dead_code` が機械で落とす」も**採れない**。bench は外部クレートで、
`app_lib::search::store::{bucket, file_table, node_table, segment, snapshot}` の5つを
import している（`search_bench.rs:30-34`）。

**`pub` で呼び手ゼロを機械で落とす手は、いまのところ無い。**

### 途中で1回踏んだ

テストを移すのに範囲で切り出して、**同じテストが2つできた**（`cargo build` が
`defined multiple times` で落ちた）。塊の切り出しは行の範囲でなく
**名前の一覧を取ってから**やること。

### 検証

- `npm run verify` **667 passed**、`npm run verify:rust` **通った**
- `cargo test --lib search::store` **18 passed**（r2 から +1）
- `scripts/rustdoc-ratchet.sh` **11 / baseline 11**
