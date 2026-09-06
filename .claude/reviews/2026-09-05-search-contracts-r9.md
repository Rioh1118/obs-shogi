# レビュー search-contracts ラウンド9

- 日付: 2026-09-05
- 範囲: `d3ef54f0..266756d4` の3コミット
- 走らせた reviewer: rust / comment
- 前ラウンド: `2026-09-05-search-contracts-r8.md`

**件数は 29 → 16 → 20 → 11 → 8 → 9 → 7 → 7 → 6。**

**2つの reviewer が独立に、同じ HIGH を挙げた。** r8 で足したラチェットが
**5つの門番のうち3つで恒真だった** —— 機械に渡したつもりのものが働いていなかった。

## 所見

### HIGH

#### R9-A ラチェットの文言が最初の `{` で切れ、3つの門番で恒真

rust / comment（両方）。`tests/index_cache_guard_names.rs:85`。

**実測**（切り出しを再現して確認）:

| 門番の文言                        | 取れていた語            | 書き側テストの本体に出る回数 |
| --------------------------------- | ----------------------- | ---------------------------- |
| `fork range {}+{} is out of...`   | `fork range`            | 1                            |
| `key belongs to bucket {} but...` | `key belongs to bucket` | 2                            |
| `bucket {b} is not sorted`        | **`bucket`**            | **43**                       |
| `file {} has occurrences but...`  | **`file`**              | **26**                       |
| `node_id {} is out of range...`   | **`node_id`**           | **10**                       |

**下の3つはどれも題材の中で当たっていて、assert を見ていない。**
`bucket` の1件目は関数名そのもの、`file` は `file_id: 1` の欄、`node_id` は `node_id: 0` の欄。

もっと悪い形が2つあった。

- **文言が `{}` で始まると固定部分が空になり、`(!p.is_empty())` で黙って落ちる。**
  `phrases.is_empty()` の番は全滅したときしか鳴らないので、**その門番はテストを
  1本も足さずに緑。** いまの `bucket {b} is not sorted` から語を1つ削れば届く
- `write_side` は `src.split("fn ")` で切っていたので**次のテストの doc まで入る**。
  照合先に散文が混ざり、当たりやすさがさらに上がる

### MEDIUM

#### R9-B 規約が「数はラチェットが見る」と書くが、読む側に受け手が無い

rust / comment（両方）。`index_cache.rs:881,893-895` / `index_cache_guard_names.rs:18-19`。

同じコミットで入った2つの doc が正面から食い違う。ラチェットの2本はどちらも
**数を持たない**。読み側は照合対象ですらない。

そのうえ示された数え方は現物に足りない。`superseded_versions_are_never_accepted_again` /
`a_file_id_from_a_corrupt_cache_cannot_decide_how_much_to_allocate` /
`a_corrupt_length_cannot_decide_how_much_to_allocate` は**どの綴りにも入らない。**

#### R9-C `fn_names` の doc が、`blank_out_strings` がしないことを理由に挙げている

rust / comment（両方）。`index_cache_guard_names.rs:39-41` / `scanning/mod.rs:151-153`。

`blank_out_strings` は**コメントを残す**と明記されている。実際に効いているのは
行頭一致（`/// fn foo()` は `///` で始まるので前置詞が外れる）。

この repo は走査器を3つ持ち分けていて、**どれを選んだかの理由が次の人の選択根拠になる。**

#### R9-D 題材を3つに増やしたのに、説明するコメントが2つのまま

comment。`index_cache.rs:2253,2300-2301`。

「file 1 と file 2 に」「**file 2 は出現ゼロ**」と書いてあるが、節表は3つあり
**壊す対象は file 3**。しかも肝心なのは「壊す対象が出現ゼロであること」
（出現があると `checked_file_id` や `node_id` の検査が先に落ちて `is not after` を踏まない）で、
**名指しされているのは壊す対象でない方。**

#### R9-E モジュール doc に、doc が3回間違えた経緯が残っている

comment。`index_cache_guard_names.rs:8-10`。

`CONTRIBUTING.md` の「変更の経緯を書かない」に当たる。括弧の3件は
**いまのツリーに存在しない過去の doc の状態**で、読み手は突き合わせようがない。

## 実測で問題なしと判断したもの

- **`if let Some(prev)` への書き換えで意味は変わっていない**（同値、エラー文言も1バイト同じ）
- **3つに増やした題材は両方の腕を本当に踏む。** `3 → 1` は `prev == 2` なので `<` の腕、
  `3 → 2` は `==` の腕。r8 の表の主張は正しい
- **`query_service.rs` から数を落としても読み手は困らない。** 「`decode_all` の門番」で
  1関数に着き、そこは `// ---- ` の節見出しで区切られている
- **`search.md:273` の書き換えは反実仮想の印が付いた**
- **`refusal_phrases` は複数行 `format!` で panic しない**（ASCII 境界）

## 結果（r9 の修正）

**6件すべて直した。2コミット**（`b08c3cf0` / `5a407c9e`）。

### R9-A: 切り出しを「最長の固定部分」に変えた

`bucket {b} is not sorted` → **`is not sorted`**（`bucket` ではなく）。

- `\` で継いだ行は**字下げごと詰める**（Rust の意味論と同じ）
- **固定部分が `MIN_PHRASE`（10バイト）より短い門番は素通りさせず落とす**
- 走査は `encode_all` の本体に限り、照合先も `item_end` で**関数本体だけ**に切る
- 切り出しは純関数なので**単体テストを3本**置いた

**実効化した結果、4つの assert が門番の文言を部分しか見ていないと出た。**
`not sorted` → `is not sorted`、`out of range` → `is out of range for file`、
`no node table` → `has occurrences but no node table`、
`fork range` → `is out of the fork table for file`。

### reviewer が挙げた偽陰性に変異を当てた

| 変異                                 | 直す前 | 直した後       |
| ------------------------------------ | ------ | -------------- |
| (a) 門番を足してテストを足さない     | 緑     | **落ちる**     |
| (b) `is not sorted` の assert を消す | 緑     | **緑**（下記） |
| (c) 門番の文言を `is unsorted` に    | 緑     | **落ちる**     |
| (d) 固定部分が短い門番を足す         | 緑     | **落ちる**     |

**(b) は宣言した限界そのもの。** `_neither_written_nor_read` のテストが読み側で
同じ句を assert しているので照合が当たる。**doc の書き方を
「両側を見るテストの中では見分けられない」から
「同じ句を読み書き両側で使う門番は、片側の assert を消しても落ちない」に直した** ——
前者は限界を狭く見せていた（片側だけのテストでも起きる）。

### R9-B: 規約の適用範囲を絞った

**ヘッダの検査（版 / magic / root hash / 長さ / `file_id`）を対象外に。**
あれらは blob を読めるかどうかの検査で、構造の門番とは別の族。
`a_corrupt_length_cannot_decide_how_much_to_allocate` のように
**何を守っているかを名前に持つ方が読みやすい。**

「数はラチェットが見る」も実態に直した ——
**書く側の網羅は機械が見る。読む側に本数を見る機械は無い。**

### 検証

- `npm run verify` **667 passed**、`npm run verify:rust` **通った**
- `cargo test --lib search` **93 passed**、ラチェット **13 passed**（うち単体3本）
- `scripts/rustdoc-ratchet.sh` **11 / baseline 11**

## r10 へ

**r10 が0件なら打ち切って `store/` に移る。** 焦点:

1. **実効化したラチェットに、まだ恒真の穴が無いか**（`MIN_PHRASE` の値、`item_end` の切り方）
2. **締めた4つの assert が、狙った門番で落ちるか**
3. **規約から外した3本のテストが、外していい理由を持っているか**
