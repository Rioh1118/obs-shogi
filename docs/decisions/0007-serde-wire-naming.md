# ADR-0007: Tauri の境界に出る型は camelCase に揃え、値つき enum は判別できる形で出す

- 日付: 2026-09-02
- 状態: 採用

## 文脈

Rust と TS の間に出る型の綴りに規則が無い。TS 側は Rust の型を**手で書き写して**
いるだけなので（`src/entities/*/api/rust-types.ts`）、綴りがずれても
**Rust も TS もコンパイルが通り、実行時に `undefined` を読む**。

実測（2026-09-02）。**再現できる形で書く。**

```sh
# Serialize / Deserialize を導出する型の数
grep -rn '^\s*#\[derive' --include='*.rs' src-tauri/src/ | grep -Ec 'Serialize|Deserialize'
# => 68

# search/types.rs の derive 数と camelCase の数
grep -c '^#\[derive' src-tauri/src/search/types.rs                 # => 20
grep -c 'rename_all = "camelCase"' src-tauri/src/search/types.rs    # => 18

# 綴りの流儀ごとの数
grep -rn 'rename_all = "camelCase"' src-tauri/src | wc -l   # => 35
grep -rn 'rename_all = "lowercase"' src-tauri/src | wc -l   # => 2
grep -rn 'rename_all = "snake_case"' src-tauri/src | wc -l  # => 1
```

**`26` と `2` だけは `src-tauri/tests/serde_naming.rs` が持つ**
（`BASELINE` と `UNTAGGED_ENUM_BASELINE`。`cargo test --test serde_naming` の
`assert_eq!` が現物と突き合わせる）。上の数はテストからは出ないので、
コマンドを併記した。

|                                                  |                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| `Serialize` / `Deserialize` を導出する型         | 68                                                                 |
| うち `rename_all = "camelCase"` が付いていない型 | **26**（保存ファイルと境界外の11型を除く）                         |
| 値なし enum の綴りの流儀                         | **4通り**（`camelCase` / `lowercase` / `snake_case` / **無指定**） |
| 値つき enum で internally tagged でないもの      | **2**（`EngineOptionType` / `EvaluationKind`）                     |

**4通り目の「無指定」が一番危ない。** rename が無い enum は Rust の
バリアント名がそのまま（PascalCase で）線に出て、TS 側がその綴りを写している。

- `src/search/types.rs` の `IndexState` → TS は `"Empty" | "Restoring" | …`
- 同 `Consistency` → `src/entities/search/api/contract.ts` の
  `"BestEffort" | "WaitForClean"`。呼び出しは
  `src/features/position-search/ui/PositionSearchModal.tsx` の
  `consistency: "BestEffort"`

決定1 を既存に当てると**この文字列リテラルが黙って外れる**。移行の対象を
数えるときに、rename 済みの側へ数え落としやすい。

揃っているのは `search/types.rs` だけ（20型中18が camelCase。残る2つが上の
`IndexState` と `Consistency`）。`search/` 全体では 24 型中 18。
`engine/types.rs` は11型すべてに rename が無く、`pv_line` / `first_move` /
`option_type` がそのまま線に出ている。`file_system/types.rs` の `FileTreeNode` は
規則が無いので `#[serde(rename = "isDir")]` と**1欄ずつ手で**当てている。

食い違いは既に1つ在る。`AnalysisUpdate` は `session_id` で出しているのに
`src/entities/engine/api/events.ts` は `payload.sessionId` を読む。
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

`research/shogihome/05-usi-engine.md` が「型情報を捨てている」と評しているのは
obs-shogi の `EnginePreset.options`（`src-tauri/src/engine_presets.rs` の
`HashMap<String, String>`）で、**そちらはこの ADR の対象外**（保存ファイルの形。
下の 4 の EXEMPT）。

ここで直すのは `EngineOptionType`（`engine/types.rs`）が TS 側で絞り込めない点だけ。
`min` / `max` / `vars` は保持しているのに、externally tagged なせいで
判別可能ユニオンにならない。

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
**タプル型のバリアントは serde が internally tagged にできない。**
`engine/types.rs` の `MateInMoves(i32)` / `MateUnknown(bool)` がそれで、
移行するときは `MateInMoves { moves: i32 }` の形へ直す必要がある。
**この ADR では直さない**（5 のとおり既存は据え置く）。

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

`docs/proposals/naming-and-module-layout.md`（**未採用**）の決定5 は
`AppConfig.root_dir` → `workspace_dir` を `#[serde(alias)]` で移行する案を持つ。
採用されると、ここの「保存ファイルは綴りを変えられない」という理由が一部否定される。
綴りの規則（この ADR）と欄の意味の改名（あちら）は別の話だが、同じファイルに
掛かるので、**あちらを採るときにこの節を見直すこと。**

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
