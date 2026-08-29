# レビュー scss-scale-tokens ラウンド4

- 日付: 2026-08-29
- 対象コミット: `6e51a27`（34コミット）
- 走らせた reviewer: `robustness` / `comment` / `architecture`
- 前ラウンド: r1（BLOCK1/HIGH8/MEDIUM15）、r2（BLOCK1/HIGH3/MEDIUM9）、r3（HIGH4/MEDIUM12/LOW1）— **いずれも全件対応済み**

**r1〜r3 の再掲は無い。**

---

## 所見

### [BLOCK] `$duration-*` の根拠の件数が同じブランチの2コミット後に腐り、「全部段にする」が偽

- reviewer: `comment`（`robustness` が MEDIUM で同旨）
- 場所: `src/index.scss:63-64`、`docs/decisions/0003:111-114`

走査器と同じ条件で数え直した実測:

| 値        | 実測   | コメントの主張 | 段            |
| --------- | ------ | -------------- | ------------- |
| 120ms     | **49** | 52             | `$duration-3` |
| 140ms     | **24** | 25             | `$duration-4` |
| 100ms     | 23     | 23 ✓           | `$duration-2` |
| 200ms     | 20     | 20 ✓           | `$duration-6` |
| 160ms     | 15     | 15 ✓           | `$duration-5` |
| **150ms** | **9**  | 記載なし       | **無し**      |
| 80ms      | 8      | 記載なし       | `$duration-1` |
| 90ms      | 4      | 記載なし       | 無し          |

1. **52 と 25 は `5d79e0d` 時点の値。** 直後の `ed33167`（ContextMenu の 120ms×3 と 140ms×1 を寄せた）で
   49 / 24 に落ちている。**同じブランチの中で1コミット後に腐った**
2. **「実測の山を全部段にする」が偽。** 150ms は9件あって段が無く、8件の 80ms には段がある。
   **件数の多い側が落ちて少ない側が拾われており、選定規則が読めない**

---

### [BLOCK] `scale-exempt` の最初の利用者に付いた理由が、既定でも唯一の呼び出し元でも偽

- reviewer: `comment`
- 場所: `src/entities/position/ui/BoardPreview.scss:140-144`、`docs/decisions/0003:81`

`__coordinate` が px で固定されているのは `data-size` が `"small"` / `"large"` のときだけ。
既定は `medium`（上書きなし）で、`data-size` は数値を渡すと `"custom"`（上書きなし）になる。

**唯一の呼び出し元 `PositionPreviewPane.tsx:62` は `size={boardSize}`（数値）を渡すので、
実行時の `__coordinate` は必ず `calc(var(--square-size) * 0.2)`** — コメントが「それはやらない」と
言っている方式そのもので描画される。

**r2 の BLOCK が、値を戻したあとに理由だけ別の偽の形で戻ってきている。**
この2行は `exempt` 枠の唯一の利用者であり、印の使い方の手本になる。

---

### [HIGH] 走査器は `tsc` の対象外に置かれており、今この瞬間に型エラーが3件ある

- reviewer: `architecture`
- 場所: `tsconfig.app.json:29-30`、`src/__tests__/*`

```json
"include": ["src"],
"exclude": ["src/**/__tests__/**", "src/**/*.test.ts", "src/**/*.test.tsx"]
```

`tsconfig.json` の `references` は app と node の2つだけで、`node` は `vite.config.ts` のみ。
**この3ファイルはどの project にも属していない。**

同じ設定で直接掛けると:

```
scssScale.test.ts(2,10):        TS1484: 'Bucket' is a type and must be imported using a type-only import
scssScaleRatchet.test.ts(4,10): TS1484: 同上
scssScaleRatchet.test.ts(40,19):TS2352: Conversion of type '{ [k: string]: never[]; }' ...
```

ADR は「走査器にテストが無いと穴が件数の減少としてしか現れない」と書いたが、
**その走査器を `postcss` の AST 型の上に載せ替えたのに、型を検査する主体が居ない。**
`postcss` を devDependency に足した理由は `import type` だけなので、**目的がひとつも果たされていない。**

---

### [HIGH] `scss.parse()` の例外でテストファイルが丸ごと collect error になり、同居する2検査が消える

- reviewer: `robustness`
- 場所: `src/__tests__/scssScale.ts:160`、`scssScaleRatchet.test.ts:119`

壊れた `.scss` を1本置いた実測:

```
❯ src/__tests__/scssScaleRatchet.test.ts (0 test)
CssSyntaxError: <css input>:1:1: Unclosed block
```

1. **`<css input>` としか出ないので、98本のどれが壊れているか分からない**（`from` を渡していない）
2. `(0 test)` — 同居する「トークン名の衝突」と「動的 import」の**2検査も実行されなくなる**
3. **r2 の自前パーサは同じ入力で例外を投げなかった。r3 で入った退行**

---

### [HIGH] 「反復するアニメーションは秒単位」が3箇所にあるが、除外7件のうち3件はミリ秒

- reviewer: `comment`
- 場所: `src/__tests__/scssScale.ts:113`、`src/index.scss:73`、`docs/decisions/0003:115`

実装が見ているのは「`animation` か」と「`infinite` があるか」だけで、単位も長さも見ていない。
除外されている7件のうち3件は 750〜900ms。
**r2 の対応記録が「1秒未満の infinite なスピナー3件」と明示的に数えた当のものなので、
その時点で「秒単位」が偽であることは分かっていた。**

---

### [MEDIUM] `walkDecls` + `walkAtRules("include")` の2経路では拾えない逃げ道が4つある

- reviewer: `robustness`

| 入力                                                    | 結果 |
| ------------------------------------------------------- | ---- |
| `@mixin card($pad: 1.37rem) { padding: $pad; }`         | `[]` |
| `@function gap() { @return 1.37rem; }`                  | `[]` |
| `@each $n, $v in (sm: 1.37rem) { .c { padding: $v; } }` | `[]` |
| `@use "./t" with ($gap: 1.37rem);`                      | `[]` |

`CONTRIBUTING.md` は「**mixin の引数**へ移しても数えます。逃げ道にはなりません」と断言しているが、
閉じているのは `@include`（呼び出し側）だけ。`IconButton.scss:14` に既に
`@mixin btn-hover($bg, $border: null)` があり、既定値を書く形は既存の書き方。

**`@each` のマップは r3 が名指しした軸で、対応表では済んだことになっているが、
追加された fixture は値がリストの形で、指摘された形を覆っていない。**

---

### [MEDIUM] 動的 import の検査は相対指定を見ない

- reviewer: `robustness`

`src/__tests__` から `shared` へは1階層なので `await import("../shared/…")` が書け、
`DEEP_RELATIVE_IMPORT`（2階層以上）にも掛からない。実測で lint も検査も素通り。

---

### [MEDIUM] `BASELINE` の TSDoc が「増やす変更は通さない」のまま

- reviewer: `comment`

r3 の HIGH は ADR と CONTRIBUTING では直ったが、**実際に編集される場所の TSDoc だけ直っていない。**
失敗メッセージも `exempt` が増えたとき「トークンを使うこと」と、寄せ先の無い枠に対して指示する。

---

### [MEDIUM] `postcss` の明示 devDependency は解決を変えず、dependabot の管理面だけを増やす

- reviewer: `architecture`

`package-lock.json` に新しく現れたのは `postcss-scss` **だけ**。`postcss` は既に dedupe されている。
一方 `postcss` が「dependabot が直接管理する依存」に昇格し、major が単独 PR で来ると
`postcss-scss@4` の peer `^8.4.29` を割る。**`dependabot.yml` 自身がコメントで記録している
「入れ子が入って `npm ci` が止まる」失敗と同じ形。**

---

### [MEDIUM] ADR の「stylelint を導入しない理由」が、次の段落で前提ごと否定されているのに据え置き

- reviewer: `architecture`（`comment` が同旨）

判断材料は「SCSS を見るためだけの別ツールチェーンを足すか」だったが、
足した `postcss` + `postcss-scss` は stylelint が SCSS を読むときに使う構文解析器そのもの。
**比較の一方の項がもう成立していない。**
実態も逆向きで、自前は 555 行 + レビュー3ラウンド、stylelint は本体1つ + 設定1本。

---

### [MEDIUM] レイヤ名の一覧が `vite.config.ts` と走査テストに二重にある

- reviewer: `architecture`

テストの正規表現は古い6つのままでも緑。レイヤを足すと `vite.config.ts` 側は変更が強制されるが、
テスト側は追従が強制されない。**`6e51a27` はこの行を編集しながら重複には手を付けていない。**

---

### [MEDIUM] `CONTRIBUTING.md` に裸の件数が残る

- reviewer: `comment`

「7つの枠」はこの文書のどこにも列挙されておらず、しかも枠の数はブランチ内で 6 → 7 → 8 と2度動いている。
「`@use` が9箇所」は実測 **10件**（`../../../index.scss` の1件が落ちていた）。

---

### [MEDIUM] `scan` の `tokenSource` が未記載、`stripTokenReferences` の名前が実際より狭い

- reviewer: `comment`

`tokenSource` は `indirect` 枠だけを落とすが、名前とテスト名は「数えない」と広く主張している。
`stripTokenReferences` は補間 `#{…}` も落とすが、補間はトークン参照ではない。

---

### [MEDIUM] `scssScaleRatchet.test.ts` に SCSS と無関係なレイヤ検査が同居している

- reviewer: `comment`

ファイル名は「SCSS のスケールのラチェット」を主張しているが、`src/__tests__` 配下の
動的 import 禁止という無関係な検査が入っている。次にレイヤ規則を触る人はこのファイルを探さない。

---

## 重複した所見

| 箇所                            | reviewer                                |
| ------------------------------- | --------------------------------------- |
| `$duration` の件数と 150ms の穴 | `comment`(BLOCK) / `robustness`(MEDIUM) |
| stylelint の理由が失効          | `architecture` / `comment`              |

## reviewer が「問題なし」と実測で確認したもの

- `npm run build` の出力に走査器 / postcss は**混ざっていない**（`dist/assets/*.js` を grep して0件）
- `layerFreeTests` は `.ts` / `.tsx` / サブディレクトリすべてに当たる
- `postcss-scss` の import はレイヤ規則に引っかからない（引っかかるべきでない）
- SCSS の `@use` に上向きの辺は0件

## 見ていない範囲

- 実機（Tauri の WKWebView）での描画
- ADR §1 の実測表（55種 / 40種 / 45種 / 21種）と §3 の吸収件数、§4 の「約89% / 約83%」。
  **r1〜r4 を通して誰も数え直していない**
- `postcss-scss` の別バージョンでの件数

## lint / hook で強制できるもの

| 対象                                                  | 手当て                                                                                                                  |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `src/**` にどの tsconfig project にも属さないファイル | `tsc -b --listFiles` と `git ls-files` の差集合が空であることを1テストで固定できる。**今回の HIGH はこれ1本で見つかる** |
| 壊れた SCSS の所在                                    | `scss.parse(source, { from: file })`                                                                                    |
| コメントに焼いた実測件数の腐り                        | **件数をコメントに書かない。** 走査器から出す1つの経路に集約する                                                        |
| `postcss` / `postcss-scss` の版ずれ                   | `dependabot.yml` のグループ化                                                                                           |
| レイヤ名の重複                                        | fs から導出すれば構造的に消える                                                                                         |

**機械で防げないもの:** コメントに書かれた理由が実装している条件と一致しているか。
**3ラウンド続けて同じ種類の故障が出ている**（r2「複合だから判定できない」、r3「盤に従属して縮む」、
r4「秒単位」「兄弟も px 固定」）。
`comment` の提案: **コメントに「〜だから」と書いたら、その条件式がコードのどの行かを指せるかを1件ずつ確認する。**

---

## ラウンド4 の対応結果

BLOCK 2件・HIGH 3件・MEDIUM 7件すべてを処理した（`6893e81`）。**見送りは0件。**

| 所見                                                       | 対応                                                                                                                                                  |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `$duration` の件数が腐り「全部段にする」が偽               | 件数をコメントから外し ADR に集約。**「8件以上ある値に段を置く」を規則として書き、150ms を足した**（`$duration-1`…`$duration-7`）                     |
| `scale-exempt` の理由が既定でも呼び出し元でも偽            | `__coordinate` への言及を落とし、`--square-size` から導くと 4.5px まで落ちるという1点で理由を閉じた                                                   |
| 走査器が `tsc` の対象外・型エラー3件                       | `tsconfig.test.json` を `references` に追加。**`vitest` は overrides で置換されていて `node_modules/vitest` が無い**ので型だけ実体へ向けた。3件を修正 |
| `scss.parse` の例外で同居検査が消える                      | `from` を渡してファイル名を出し、走査を `beforeAll` へ移した                                                                                          |
| 「反復するアニメーションは秒単位」が偽                     | 実装している条件（反復かどうか）だけで理由を閉じた。3箇所                                                                                             |
| `@mixin` 既定値 / `@return` / `@each` マップ / `@use with` | `INDIRECT_AT_RULES` で8種の at-rule を対象に。**fixture 5件を追加**                                                                                   |
| 相対指定の動的 import                                      | `(?:@/\|\.{1,2}/)` に広げ、レイヤ名を `src/` 直下から導出。**別ファイルに分離**（`testsLayerBoundary.test.ts`）                                       |
| `BASELINE` の TSDoc と失敗メッセージ                       | `exempt` 専用の案内文に分岐。「印を1つ足したなら元の枠を1減らしてこの数を上げること」                                                                 |
| `postcss` の明示依存と dependabot                          | `dependabot.yml` に `postcss-toolchain` グループ（major 含む）を追加。**`vite-plus` で踏んだのと同じ形**                                              |
| ADR の stylelint の理由が失効                              | 「依存の数ではない」と認め、残る差（2つ目の CLI と設定、ラチェットと `exempt` を規則で表現できない）だけを理由にした                                  |
| レイヤ名の二重定義                                         | fs から導出して構造的に消した                                                                                                                         |
| `CONTRIBUTING` の裸の件数                                  | 「7つの枠」→「`exempt` 以外の枠」、「9箇所」→件数を書かない                                                                                           |
| `scan` の `tokenSource` 未記載                             | `@param` を追加                                                                                                                                       |
| ratchet にレイヤ検査が同居                                 | 分離した                                                                                                                                              |

### at-rule を広げて新たに見つかったもの

`widgets/game-board/ui/Hand.scss:6` の `@return math.div(hand.$hand-w, 1rem)`。
**`1rem` は単位を落とすための除数で意匠の寸法ではない**ので `scale-exempt` を付けた。
`exempt` 枠に**2つ目の、性質の違う利用者**ができ、専用の失敗メッセージも実際に動くことを確認した。

### 最終的な基準値

font-size 251 / border-radius 178 / spacing 528 / elevation 79 / motion 79 /
family 18 / indirect 53 / **exempt 3**

`npm run verify` 103テスト通過、`npm run build` 成功。
ビルド出力に走査器と postcss が混ざっていないことを確認（`dist/assets/*.js` を grep して0件）。
