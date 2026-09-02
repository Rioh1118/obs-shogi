# ADR-0007: Tauri の境界に出る型は camelCase に揃え、値つき enum は判別できる形で出す

- 日付: 2026-09-02
- 状態: 採用

## 文脈

Rust と TS の間に出る型の綴りに規則が無い。TS 側は Rust の型を**手で書き写して**
いるだけなので（`src/entities/*/api/rust-types.ts`）、綴りがずれても
**Rust も TS もコンパイルが通り、実行時に `undefined` を読む**。

実測（`src-tauri/src/**/*.rs`、2026-09-02。数え方は
`src-tauri/tests/serde_naming.rs` が持つ）:

|                                                  |                                                       |
| ------------------------------------------------ | ----------------------------------------------------- |
| `Serialize` / `Deserialize` を導出する型         | 67                                                    |
| うち `rename_all = "camelCase"` が付いていない型 | **26**（保存ファイルと境界外の11型を除く）            |
| 値なし enum の綴りの流儀                         | **3通り**（`camelCase` / `lowercase` / `snake_case`） |
| 値つき enum で internally tagged でないもの      | **2**（`EngineOptionType` / `EvaluationKind`）        |

揃っているのは `search/` だけ（18型中16が camelCase）。
`engine/types.rs` は11型すべてに rename が無く、`pv_line` / `first_move` /
`option_type` がそのまま線に出ている。`file_system/types.rs` の `FileTreeNode` は
規則が無いので `#[serde(rename = "isDir")]` と**1欄ずつ手で**当てている。

食い違いは既に1つ在る。`AnalysisUpdate` は `session_id` で出しているのに
`src/entities/engine/api/events.ts:23` は `payload.sessionId` を読む。
**いまは無害**で、読んでいるのが `analysis-complete` のハンドラであり、
Rust はそのイベントを一度も emit していない（実測0箇所）。読み手が増えた瞬間に
`undefined` になる形で残っている。

### 値つき enum は TS 側で絞り込めない

serde の既定は externally tagged なので、`EngineOptionType` はこう出る。

```json
{ "Spin": { "default": 16, "min": 1, "max": 1024 } }
```

TS 側の写しは**全部 optional の袋**になり、判別可能ユニオンにならない。

```ts
interface EngineOptionType {
  Check?: { default?: boolean };
  Spin?: { default?: number; min?: number; max?: number };
  // ...
}
```

`research/shogihome/05-usi-engine.md` が「obs-shogi は USI オプションの型情報を
捨てているので強さのスライダは原理的に作れない」と書いた原因はここにある。

### `rename_all` は enum のバリアント名にしか効かない

対局の型を書いたときに踏んだ。`#[serde(rename_all = "camelCase")]` を付けた
enum でも、**バリアントの中のフィールドは snake_case のまま出る**
（`PlayerSpec::Engine` の `engine_path`、`GameEvent` の `usi_move`）。
`rename_all_fields = "camelCase"` を別に足す必要がある。
属性が付いているので**目視では揃って見える**のが厄介なところ。

## 決定

### 1. Tauri の境界に出る型は `rename_all = "camelCase"`

Tauri はコマンドの**引数名**を既に camelCase で受ける（`invoke("initialize_engine",
{ enginePath })`）。payload だけ snake_case なのが現状の不整合なので、payload を
引数側に合わせる。

### 2. 値つき enum は internally tagged にする

```rust
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
```

TS 側が `switch (o.kind)` で絞り込める形になる。
**タプル型のバリアントは serde が internally tagged にできない**ので、
`MateInMoves(i32)` は `MateInMoves { moves: i32 }` へ直す。

### 3. `tag` を付けたら `rename_all_fields` も必ず付ける

これはラチェットではなく**0件でなければ落ちる規則**にする。
片方だけ付いている状態は「揃えたつもりで揃っていない」であり、
目視で見つからないため。

### 4. 対象外は2種類だけ。理由を伴わせる

1. **保存ファイルの形**。綴りを変えると利用者の既存ファイルが読めなくなる
   （`AppConfig` / `PresetsFile` / `StudyPositionsFile` とその要素）
2. **Tauri の境界に出ない**。TS が読まないので揃える相手がいない
   （検索インデックスのキャッシュ）

一覧は `src-tauri/tests/serde_naming.rs` の `EXEMPT`。
**「まだ直していない」は理由にならない。** それは 5 のラチェットが数える側。

### 5. 既存はラチェットで守り、移行は別に切る

`src-tauri/tests/serde_naming.rs` が違反の件数を数え、**増えたら落ちる**。
26 と 2 が現在値で、減らしたら定数も同じコミットで下げる。

既存の26型をこの ADR の中で移行しない。`engine/types.rs` の11型は
`pv_line` → `pvLine` のように TS 側の読み手（解析ペイン・棋譜ストリーム）へ
広く及ぶので、対局の差分と混ぜると**どちらも読めなくなる**。

Rust 側に置いたのは、`.rs` を触ったときに走る検証が `npm run verify:rust` だから
（`.claude/hooks/verify-gate.sh` の判定）。TS 側の `src/__tests__/` に置くと、
**型を足した人のところでは走らない**。

## 帰結

- 新しく境界に出す型は必ず camelCase になる。忘れると `cargo test` が落ちる
- 値つき enum を新しく足すときは internally tagged が既定になる
- **既存の26型は当面ずれたまま残る。** ラチェットは「増えないこと」しか保証しない
- 綴りが合っていることは保証されるが、**実際に出る JSON の形までは見ていない**。
  そこは境界の型ごとに `#[test]` を書く（`engine/game/types.rs` の
  `the_wire_shape_is_camel_case_all_the_way_down` が例）

## 却下した案

**externally tagged のまま、フィールド名だけ揃える。**
差分は小さいが、TS 側が絞り込めない問題が残る。USI オプションの型付けは
対局の設定画面で必ず要るので、先送りしても同じ場所をもう一度触ることになる。

**既存も全部この PR で移行する。**
対局の差分が読めなくなる。`/implement` 手順1「ついでに直すを混ぜない」。
