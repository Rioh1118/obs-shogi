# レビュー scss-scale-tokens ラウンド2

- 日付: 2026-08-29
- 範囲: `issue-160/scale-tokens` の `git diff main...HEAD`（21コミット）
- 対象コミット: `8ea6ec9`
- 走らせた reviewer: `robustness` / `architecture` / `comment` / `ui`
- 前ラウンド: `.claude/reviews/2026-08-29-scss-scale-tokens-r1.md`（BLOCK 1 / HIGH 8 / MEDIUM 15、全件対応済み）

**ラウンド1の所見の再掲は無い。以下は全て、ラウンド1の修正で新しく入った問題か、対応が不十分だったもの。**

---

## 所見

### [BLOCK] `scale-exempt` の理由が事実と違う。この2行は盤の大きさに従属していない

- reviewer: `comment`
- 場所: `src/entities/position/ui/BoardPreview.scss:141-142,170-171`、`src/__tests__/scssScaleRatchet.test.ts:57-61`、`docs/decisions/0003-scss-scale-tokens.md:80-81`

`__hand-label` / `__hand-empty` は `0.75rem` / `0.625rem` の**固定値**で、`--board-size` にも
`--square-size` にも `em` にも繋がっていない。同じファイルに本当に盤へ従属する書き方が別にある。

```scss
--board-size: 300px;
--square-size: calc(var(--board-size) / 9);
&__coordinate {
  font-size: calc(var(--square-size) * 0.2);
}
```

**「盤の大きさに従属して縮む」は、そのコメントが付いている当の2行について偽。**
しかもこの偽の理由が3箇所（SCSS のコメント / テストの TSDoc / ADR §3）に複製され、
**ラチェットからの恒久的な除外の唯一の根拠**になっている。
次に `scale-exempt` を使う人はこれを「小さい文字なら付けてよい印」と読む。

実際に盤へ従属している唯一の駒台文字は `widgets/game-board/ui/Hand.scss:13` の
`font-size: calc(100cqw / #{hand-w-unit()})` で、そちらは単位を持たないので最初から数えられない。
**除外が要る場所と印が付いた場所がずれている。**

---

### [HIGH] `@include` の引数走査が最初の `)` で止まり、ラウンド1で塞いだはずの抜け道が開いている

- reviewer: `robustness`
- 場所: `src/__tests__/scssScaleRatchet.test.ts:157`、`src/shared/ui/IconButton.scss:47,71,116`

`INCLUDE_ARGUMENTS = /@include\s+[\w-]+\s*\(([^)]*)\)/g` の `[^)]*` は最初の `)` で止まる。
**入れ子の関数呼び出しを引数に置いた `@include` はこのリポジトリに実在する。**

```scss
@include btn-active(color.adjust(index.$color-secondary-dark-2, $lightness: -5%)); // :116
@include btn-hover(var(--color-bg-hover, #e9ecef), var(--color-border-hover, #adb5bd)); // :71
```

実測: `@include btn-size(rgba(0, 0, 0, 0.5), 1.2rem, 2.4rem);` は `indirect` **0件**。
第1引数に括弧付きの関数を1つ置くだけで、それ以降の直値が何個あっても数えられない。
`IconButton.scss` は既にこの形なのでコピー元に困らない。

`robustness` が括弧を数える版で実測し、**現在の件数は 3 → 3 で変わらない**ことを確認している。

---

### [HIGH] `LOOPING_ANIMATION` が `transition` にも効き、宣言全体の計上を無効にする

- reviewer: `robustness`（`comment` が粒度の側から同旨）
- 場所: `src/__tests__/scssScaleRatchet.test.ts:83-87`

判定材料が「値の中に1秒以上の時間があるか」だけで、プロパティが `animation` かも `infinite` があるかも見ていない。
判定は宣言単位なので、1つ該当すれば**同じ宣言の他の直値も全部消える**。

| 入力                                                | motion                                            |
| --------------------------------------------------- | ------------------------------------------------- |
| `transition: width 1s ease;`                        | **0件**（反復でない普通のトランジションが素通り） |
| `transition: opacity 0.2s ease, width 1.2s linear;` | **0件**（`0.2s` まで巻き添え）                    |
| `transition-duration: 1s;`                          | **0件**                                           |

`0.9s` を `1s` に書き換えるだけでガードが外れる。
現在 `LOOPING` で除外されている4件（`Spinner.scss:14` / `AnalysisPaneHeader.scss:40` /
`BootSplash.scss:26,49`）は**全て `animation` かつ `infinite`** なので、
条件をそれに替えても `BASELINE.motion` は 84 のまま。

---

### [HIGH] `$font-mono` だけラウンド1の対応から漏れている。逐語コピーが8箇所ある

- reviewer: `architecture`
- 場所: `src/index.scss:28`、`src/__tests__/scssScaleRatchet.test.ts:169-178`

ラウンド1の HIGH は「motion / mono / elevation」の3つが対象だったが、`4927527` が足したのは
`ELEVATION_PROPERTIES` と `MOTION_PROPERTIES` だけ。**`font-family` は `bucketOf` の `return null` に落ちる。**

`$font-mono` と1文字違わない値が8箇所にある（`KifuReadErrorDialog.scss:56,106,142` /
`SetupGuide.scss:190,202,225,265` / `AiLibraryTab.scss:305`）。
`architecture` が9番目のコピーを足して `npm run test` が**緑のまま**であることを実測している。

ADR-0003 が「規約だけにしない理由」に挙げた `$default-font-size` の再現そのもので、
今回は**寄せ先が既にあり、逐語コピーが8つ実在する**分だけ悪い。

---

### [MEDIUM] 値に `:` を含む宣言は丸ごと落ちる。Sass マップが `indirect` の抜け道になる

- reviewer: `robustness`
- 場所: `src/__tests__/scssScaleRatchet.test.ts:128`

値の部分が `[^:]*` なので、`:` を含む値を持つ宣言はどのバケツにも入らない。

```scss
$sizes: (
  sm: 0.4rem,
  md: 0.8rem,
  lg: 1.37rem,
); // 0件
.a {
  --icon: url("data:image/svg+xml;utf8,<svg/>");
} // 0件
```

`CONTRIBUTING.md` は「寸法をローカル変数・カスタムプロパティ・mixin の引数へ移しても数えます。
プロパティ名から離しても逃げ道にはなりません」と断言しているが、
**Sass マップは寸法を変数へ逃がす最も自然な書き方**で、それが丸ごと見えない。

`robustness` が「値に `:` を許す版」と現行を全 SCSS で突き合わせ、**差分0件**を確認している。

---

### [MEDIUM] `scale-exempt` が `@include` に効かず、1行に複数宣言があると全部まとめて消える

- reviewer: `robustness` / `comment`（**2人が独立に指摘**）
- 場所: `src/__tests__/scssScaleRatchet.test.ts:219,223-227`

`@include` の経路には印の判定が無い。一方、失敗メッセージと `CONTRIBUTING.md` は
全6枠に同じ「印を付ければ数えない」を出す。**`@include` で渡した人は案内どおりに書いても落ち続け、
基準値を上げるのは規約で禁じられているので行き止まりになる。**

| 入力                                                  | 結果                                                     |
| ----------------------------------------------------- | -------------------------------------------------------- |
| `@include btn-size(1.2rem); // scale-exempt`          | **計上される**（印を見ていない）                         |
| `.a { padding: 1rem; margin: 2rem; } // scale-exempt` | **2件とも免除**（印1つで行全体が抜ける）                 |
| 折り返した宣言                                        | 記録行はプロパティのある行。値の行に印を書いても効かない |

---

### [MEDIUM] `scale-exempt` の使用数だけラチェットが無い

- reviewer: `architecture`
- 場所: `src/__tests__/scssScaleRatchet.test.ts:61,219,274-280`

6つの枠は全て `toBe` で守られているが、**印の使用数はどこにも数えられていない。**
`architecture` が印付きの宣言を3つ足して**緑のまま**であることを実測している。

失敗メッセージは「トークンを使え」と「印を付ければ数えない」を同じ重みで並べており、
後者は**どのトークンを選ぶかを考えなくてよいぶん常に安い**。
`BASELINE` の編集は定数の diff としてレビューに出るが、行末コメント1つは出ない。

---

### [MEDIUM] `blankComments` が文字列と `url()` を知らないので、件数が「黙って減る」

- reviewer: `robustness`
- 場所: `src/__tests__/scssScaleRatchet.test.ts:112-115`

```scss
.a {
  background-image: url(https://x.test/a.png);
  padding: 1rem;
} // 0件
```

`//` から行末まで（`;` も `padding` も）空白化される。行コメント中の `/*` が
先に走る `/* */` の置換に食われる経路もある。

**これは「検出漏れ」ではなく「件数が減る」方向に働く。** 減った分は基準値として固定され、
基準値は下げる方向にしか動かせないので**その枠は二度と戻らない**。
現在この形は0件（`://` の grep はゼロ）なので今の基準値は正しい。

---

### [MEDIUM] `layerFreeTests` は静的 import しか見ない

- reviewer: `architecture`
- 場所: `vite.config.ts:51-70`

**後勝ちの懸念は成立しない**ことを `architecture` が実測で確認している（プローブで発火）。
一方 `await import("@/shared/…")` は `npx vp lint` が **exit 0**。
`vi.mock("@/…")` の文字列も同様で、**どちらもこのリポジトリの既存テストが実際に使っている書き方**
（`entities/analysis/model/__tests__/provider.test.tsx:14,18,19` ほか）。

---

### [MEDIUM] 刻みが宣言どおり 2.4rem まで張れていない

- reviewer: `ui`
- 場所: `src/index.scss:32,42-43,46-52`、`docs/decisions/0003-scss-scale-tokens.md:87`

「0.2rem 刻みを 2.4rem まで欠けなく張る」と書いた直下で、`$space-10`(2rem) の次が
`$space-11`(2.4rem) で **2.2rem が無い**。角丸は `$radius-3xl`(1.6rem) 止まりで 2.4rem に届いていない。

寄せ先を持たない実測値が残る: `PositionNavigationHeader.scss:20` の `22px`（2rem と 2.4rem に割れる）、
`FloatingNote.scss:15` の `border-radius: 1.8rem`（寄せ先なし）。
**ADR:87 が「割れる」と書いた状態そのもの。**

---

### [MEDIUM] `welcome-screen__title` の修正で、1280x800 で切れる量が 17px 増える

- reviewer: `ui`（headless Chrome で実測）
- 場所: `src/pages/WelcomeScreen.tsx:14`、`src/pages/AppLayout.scss:44-49`、`src/shared/ui/Title.scss:5-6`

|                        | pane  | content | 上にはみ出す | 下にはみ出す |
| ---------------------- | ----- | ------- | ------------ | ------------ |
| main（綴り誤りのまま） | 631px | 746.2px | 37.6px       | 77.6px       |
| このHEAD               | 631px | 763.2px | 46.1px       | 86.1px       |

**ラウンド1報告書の「`ui` は入りきらなくなる箇所は見つからなかった」は誤り。**
`.title` の既定が `font-size: 12.8rem / padding: 5rem` のため、この画面は
**main の時点で 1280x800 で上下が切れている。** 親が `overflow: hidden` なのでスクロールバーも出ず、
対応拡張子の一覧に到達できない。この変更はそれを 115px → 132px に広げる。
ウィンドウ高 829〜845px の帯は、**この変更の前は収まっていて後は切れる**。

h2 の修正自体は正しいので戻さない。

---

### [MEDIUM] `$shadow-overlay` が `ContextMenu.scss` の直値と1バイト違わぬ複製になった

- reviewer: `ui`
- 場所: `src/index.scss:74-77`、`src/widgets/file-tree/ui/ContextMenu.scss:9-11`

ラウンド1は「値が実在するポップオーバーと一致しない」を直したが、**`ContextMenu` 側を書き換えなかった**ので、
同じ影が2箇所に別々の形（トークンと直値）で存在する。片方だけ直すと再び食い違う。

裏付けとして、**このブランチが足した30個のトークンのうち参照があるのは `$font-body` 1件だけ**で、
残り29個は0件。ラチェットは件数の増加しか見ないので**この0件は永久に検出されない。**

値が一致している今なら、最初の利用者を無リスクで作れる（`BASELINE.elevation` 80 → 79）。

---

### [MEDIUM] 文書の数値と記述の誤り 4件

- reviewer: `comment`

| 場所                        | 内容                                                                                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.scss:86`         | 「@use している**81ファイル**」は実測 **83**。しかも SCSS を1本足すたびに腐る                                                                        |
| `docs/decisions/0003:100`   | 「2s / **15s** などの長い値」— `15s` は `src/**/*.scss` に**存在しない**。最長は 2.8s                                                                |
| `docs/decisions/0003:97-98` | 「**「モーダル」という名前**は実際の用途と合っていなかった」— `main` の `$shadow-1` にコメントは無い。これはブランチ内の中間状態を指す**経緯の記述** |
| `docs/decisions/0002:6`     | `関連:` 行の「Q-003（この ADR で決着）」が現在形。Q-003 は今も 🔴 未決。撤回済み ADR から「決着」を受け取ることになる                                |

---

### [MEDIUM] `$radius-xs…3xl` と `$space-N` で命名方式が割れ、理由が書かれていない

- reviewer: `comment`
- 場所: `src/index.scss:46-54`、`docs/decisions/0003:67,88-89,104`

ADR §4 は間隔と角丸を同じ段落で同じ方針（役割名を付けない）として扱いながら、
片方は連番、片方は t-shirt。**§3 が font に対して sm/md を却下した理由はそのまま角丸にも当てはまる。**
増段時に `$radius-2xs` や `4xl` が要る。`index.$radius-*` の使用は現在0件なので置換コストは3箇所。

---

## 重複・矛盾した所見

- **`scale-exempt` に4件が集中**（BLOCK の理由の偽、`@include` に効かない、行単位、ラチェットが無い）。
  ラウンド1で入れた仕掛けが、そのまま次のラウンドの最大の塊になった
- `LOOPING_ANIMATION` の粒度は `robustness` と `comment` が独立に指摘。直し方は一致
  （免除条件に `infinite` の同居を要求する）
- **矛盾する提案は無い**

## 見ていない範囲

- 実機（Tauri の WKWebView）での描画確認。`ui` の実測は headless Chrome、幅 1280 のみ、高さ2点
- WelcomeScreen 以外の画面はレンダリングしていない
- ADR の実測表のうち役割別の段数（`__title` 13種など）と各段の吸収件数は誰も数え直していない
- `src-tauri/` と `.tsx` のロジックは差分に含まれない

## lint / hook で強制できるもの

**共通の原因: 走査器そのものにテストが1本も無い。** `scssScaleRatchet.test.ts` は
「リポジトリ全体の件数」しか主張しておらず、走査器を合成 SCSS で叩く検査が無い。
**今回の `robustness` の所見は全て、走査器に文字列を食わせるだけで再現した。**

| 対象                                          | 手当て                                                                                             |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 走査器の穴（今回の HIGH 2件 + MEDIUM 3件）    | `declarations` / `blankComments` / `hasRawLiteral` を export し、fixture テストを置く              |
| `font-family` の逐語重複（8箇所）             | `bucketOf` に `family` 枠                                                                          |
| `scale-exempt` の無制限な増加                 | `BASELINE` に `exempt` 枠                                                                          |
| トークンの参照数0（29個）                     | `index.scss` の `$name` の参照数0を列挙。**導入直後は必ず0なので猶予とセットでないと運用できない** |
| トークンと1バイト違わぬ直値                   | トークン値を正規化して同じ文字列の宣言を検出                                                       |
| 段の刻みの穴                                  | `$space-*` の隣接差が刻み幅と一致しない箇所を落とす                                                |
| `src/__tests__` からの動的 import / `vi.mock` | 文字列走査（`no-restricted-imports` では原理的に届かない）                                         |

**機械で防げないもの:** `scale-exempt` の理由が事実かどうか（今回の BLOCK）、
中央寄せ + `overflow: hidden` で中身が切れること。

## 次ラウンドの対象

BLOCK 1件・HIGH 3件・MEDIUM 9件。**ラウンド3が必要。**

---

## ラウンド2 の対応結果

BLOCK 1件・HIGH 3件・MEDIUM 9件すべてを処理した。**見送りは0件。**

| 所見                                | コミット  | 備考                                                                                                                              |
| ----------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `scale-exempt` の理由が偽           | `511e01c` | コメントを実態に合わせるのではなく、**コメント通りにした**。`--square-size` から導く。既定 300px では 7.5px / 6.25px で従来と同値 |
| `@include` の括弧                   | `0cf3083` | 括弧の深さを数える                                                                                                                |
| `LOOPING_ANIMATION`                 | `0cf3083` | `animation` かつ `infinite` に限定                                                                                                |
| `$font-mono` が対象外               | `0cf3083` | `family` 枠を追加。実測 18件                                                                                                      |
| 値の `:`（Sass マップ）             | `0cf3083` | 値の側は何でも許す                                                                                                                |
| `scale-exempt` の範囲と `@include`  | `0cf3083` | 宣言の行範囲で判定し、`@include` にも効かせる                                                                                     |
| `blankComments` の文字列 / `url()`  | `0cf3083` | 走査器に文字列と `url()` の状態を持たせた                                                                                         |
| `exempt` にラチェットが無い         | `0cf3083` | **数えるのをやめず枠を移す**形にした。印を増やすにも基準値を動かす                                                                |
| 刻みの穴（2.2rem / 角丸 1.8rem）    | `df34c51` | `$space-12` / `$radius-8` まで                                                                                                    |
| `$radius-xs…3xl` の命名             | `df34c51` | `$radius-1`…`$radius-8` に                                                                                                        |
| `ContextMenu` が直値のまま          | `31d0622` | **出力 CSS が1バイトも変わらないことを確認**                                                                                      |
| 文書の数値 4件                      | `87c1532` | 81ファイル / 15s / 「モーダル」という名前 / Q-003 決着                                                                            |
| `layerFreeTests` が静的 import だけ | `366c103` | 文字列走査を追加。プローブ済み                                                                                                    |
| WelcomeScreen で中身が切れる        | `deaa03e` | `safe center` + `overflow: auto`                                                                                                  |

### 根本原因への手当て

`robustness` が指摘したとおり、**走査器にテストが1本も無かったこと**が
HIGH 2件と MEDIUM 3件の共通の原因だった。走査器を `src/__tests__/scssScale.ts` に切り出し、
`scssScale.test.ts` に **29件の fixture テスト**を置いた。報告された穴は全てこの形で再現し、
修正後に緑になることを確認している。

### 数え直して訂正したもの

- **`motion` が 84 → 81 と減った。** 原因は 1秒未満の `infinite` なスピナー3件
  （`PositionSearchModalHeader.scss:27` 900ms / `SButton.scss:170` 750ms /
  `WorkspaceTab.scss:15` 900ms）が正しく別系統へ移ったため。
  旧ルール（1秒以上）はこれらを取りこぼしていた。**逆方向の増加は0件**であることを差分で確認
- `@use` しているファイル数: 81 → 実測 **83**（`global.scss` の追加を含む）

### 最終的な基準値

font-size 252 / border-radius 178 / spacing 528 / elevation 79 / motion 81 /
family 18 / indirect 53 / exempt 0
