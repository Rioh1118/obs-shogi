# レビュー search-contracts ラウンド10

- 日付: 2026-09-05
- 範囲: `266756d4..eabd2ce6` の3コミット
- 走らせた reviewer: rust / comment
- 前ラウンド: `2026-09-05-search-contracts-r9.md`

**件数は 29 → 16 → 20 → 11 → 8 → 9 → 7 → 7 → 6 → 8。** 重複1件を畳んで8件。

**増えた。** r9 で「ラチェットが3つの門番で恒真」を直したが、
**恒真の入口が他に3つ残っていた。** rust reviewer は再現バイナリを作って実測している。

## 所見

### BLOCK / HIGH

#### R10-A 接頭辞を使わない門番は、ラチェットが1文字も見ない

rust（HIGH）。`index_cache_guard_names.rs:45,128`。

目印が `"refusing to write: ` の**文字列一致**なので、綴りの違う門番は集合に入らない。
規約（`index_cache.rs:881-906`）は**綴りしか定めておらず、文言の接頭辞を要求していない。**

**実測**（reviewer が再現バイナリで確認）: `encode_all` に

```rust
if occ.r#gen == 0 {
    return Err(format!("cannot write bucket {b}: generation is zero"));
}
```

を足すと抽出は**5本のまま**で `missing` も空。**テストを1本も足さずに緑。**

#### R10-B 照合先が生のソースなので、コメントに句があるだけで通る

rust（MEDIUM）。`index_cache_guard_names.rs:74,192-201`。

`write_side` はコメントを潰していない。**実測**: `err.contains("is out of the fork table for file")`
を `err.starts_with("refusing")` に弱め、句を直上の日本語コメントに残すと**緑**。

同じ根で2つ: `body_of` が素の `find`（`scanning` の doc が名指しで警告する形）、
`refusal_phrases` も生の本体を見るので**コメントに書けば幻の門番が増える。**

#### R10-C 節表テストの「出現ゼロが要る」が実測と逆

comment（BLOCK）。`index_cache.rs:2317-2320`。

**`decode_all` は節表の段（`621-678`）を桶の段（`680`〜）より先に読み切る。**
`is not after` は `639`、出現側の検査は `697` / `724` / `726` で**すべて後**。

reviewer が file 3 に出現を足した写しで確認: 両方の腕で `is not after` が出た。
**「出現があると先に落ちる」は逆。**

#### R10-D `fn_names` の doc が `blank_out_noncode` の逆を書いている

rust / comment（両方、BLOCK）。`index_cache_guard_names.rs:52-58`。

`blank_out_noncode` は `blank_out(source, true, true)` で**コメントも潰す**。
doc は「**コメントは潰していない**ので、行頭一致をやめると `/* */` の中を拾い始める」。

**r9-C で直したのと同じ誤りが、`blank_out_strings` → `blank_out_noncode` の
差し替えで再発した。** 走査器を替えて doc が追随していない。

### MEDIUM

#### R10-E `longest_fixed_part` が `{{` / `}}` を書式指定と読む

rust。`index_cache_guard_names.rs:88-103`。

**実測**:

```
"the shape {{node}} is not writable here"  ->  "} is not writable here"
"file \"{}\" has no node table at all"     ->  "\" has no node table at all"
```

門番の文言に波括弧を1つ書いた瞬間、**正しく assert していても落ち、
しかもエラーが指す直し方（先頭に `}` を付けた句を assert しろ）が誤り。**

#### R10-F `MIN_PHRASE` の doc の「43回」が現物と合わない（実測 42）

comment。`index_cache_guard_names.rs:40-42`。

43 は r9 時点の `src.split("fn ")` 版の値で、`body_of` に替えた時点で1つ減っている。
**受け手の機械が無い数なので、テストが増減するたび黙って腐る。**

#### R10-G 「規約の外の綴り」と書いてあるが実体は3語の禁止リスト

comment。`index_cache_guard_names.rs:13,148-149` / `CONTRIBUTING.md:322`。

`_is_declined` / `_is_invalid` のような綴りは素通りする。
**`## ここが見ないもの` に、最大の死角であるこの方式が挙がっていない。**

#### R10-H 「ヘッダの検査は対象外」と書いた規約に、`_refused` を名乗るヘッダ検査が3本

comment。`index_cache.rs:894-903` / 該当は `917` `990` `1005`。

doc の数え方（`_refused` で引く）に従うと6本挙がり、うち3本は
**この doc が「別の族」と宣言したヘッダ検査。** r9 で範囲を絞った狙いが崩れている。

## 確かめて穴が無かったもの

- **`item_end` は `fn encode_all` から本体を正しく切っている**（122行、現物 386–507 と一致）
- **`body_of` の前方一致は現状ぶつからない**（`fn encode_all` は1箇所。`zstd::stream::encode_all` は `fn ` を伴わない）
- **`skip_literal_or_comment` と `&from_quote[1..len-1]` は対応が取れている。**
  生文字列でも `MARK` が `#` の後の `"` に当たるのでずれない
- **`MIN_PHRASE = 10` は現状ちょうど。** 5本の固定部分は 13 / 21 / 24 / 33 / 33 バイト
- **締めた4つの assert は狙った門番を指している。** `encode_all` の5本の文言は互いに素
- **`blank_out_strings` → `blank_out_noncode` で拾えなくなったものは無い**

## 結果（r10 の修正）

**8件すべて直した。1コミット**（`03e5e512`。同じ関数群と同じ doc を触るため分けられなかった）。

| 所見      | 直し方                                                                           |
| --------- | -------------------------------------------------------------------------------- |
| **R10-A** | `return Err` の数と目印の数が一致することを assert。規約に接頭辞の行             |
| **R10-B** | `body_of` の位置決めを `find_in_code`、切り出しを `blank_out_comments` から      |
| **R10-C** | 「節表の段は桶の段より先に読み切るので、出現の有無は届かない」へ                 |
| **R10-D** | 「コメントも文字列も潰した写しから読む」へ。行頭一致の理由も実物に               |
| **R10-E** | `{{` / `}}` / `\"` を番兵に畳んでから割り、**割り終えてから戻す**。単体テスト2本 |
| **R10-F** | 数を落として理由だけに                                                           |
| **R10-G** | 死角の節に「既知の3語でしか見ない」を追加                                        |
| **R10-H** | ヘッダ検査3本を `..._cannot_be_read` へ。**ラチェットが見る腕を足した**          |

### R10-E で1回自分の罠に落ちた

番兵に畳んだ直後に戻していたので、割る側は生の `{` を見ていた。
**単体テストが落ちて気付いた。** 純関数に単体テストを置いた効果がそのまま出た形。

### reviewer が挙げた偽陰性に変異を当てた

| 変異                                  | 直す前 | 直した後                                       |
| ------------------------------------- | ------ | ---------------------------------------------- |
| (A) 接頭辞を使わない門番を足す        | 緑     | **落ちる**（`return Err` が 6 に対し文言は 5） |
| (B) assert を弱め、句をコメントに残す | 緑     | **落ちる**                                     |

### 検証

- `npm run verify` **667 passed**、`npm run verify:rust` **通った**
- ラチェット **16 passed**（うち単体5本）、`cargo test --lib search` **93 passed**
- `scripts/rustdoc-ratchet.sh` **11 / baseline 11**

## r11 へ

**この範囲は10ラウンド回っている。** r7 以降は製品でなく**検査そのものの検査**に移っていて、
r9 / r10 はどちらも「私が足したラチェットの恒真」だった。

**r11 が0件なら打ち切る。1件でも同じ族（ラチェットの恒真）が出たら、
ラチェットを消して人が見る形に戻すことを検討する** —— 恒真なラチェットは
無いより悪い（`CONTRIBUTING.md` が「逃げ道: 無し」と書いてしまう）。

焦点:

1. **`fold_escapes` / `unfold_escapes` の番兵が、現物の文言と衝突しないか**
2. **`body_of` が `blank_out_comments` の写しから切ることで、何か壊れていないか**
3. **`no_header_check_is_named_like_a_structural_guard` の `HEADER` 3語が妥当か**
4. **改名した3本を指す doc が全部追随しているか**
