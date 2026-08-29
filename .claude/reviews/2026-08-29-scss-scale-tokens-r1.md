# レビュー scss-scale-tokens ラウンド1

- 日付: 2026-08-29
- 範囲: `issue-160/scale-tokens` の `git diff main...HEAD`（5ファイル）
  - `src/index.scss` / `src/__tests__/scssScaleRatchet.test.ts` / `CONTRIBUTING.md`
  - `docs/decisions/0003-scss-scale-tokens.md` / `docs/decisions/LOG.md`
- 対象コミット: `5da914d`
- 走らせた reviewer: `architecture` / `ui` / `robustness` / `comment` / `oss-hygiene`
- 走らせなかった reviewer: `react`（`.tsx` の変更なし）/ `rust`（`src-tauri/` の変更なし）/
  `perf`（走査は 97ファイル 148ms で、`npm run verify` の8秒に対して論点にならない）

---

## 所見

### [BLOCK] ラチェットの `border-radius` 除外が、コメントの理由・実装・ADR の三方で食い違い、37件を恒久的に見逃す

- reviewer: `comment`（`architecture` `robustness` が別角度で同一箇所を指摘）
- 場所: `src/__tests__/scssScaleRatchet.test.ts:54-55`、`src/index.scss:50-51`

```ts
// pill と円はトークン側でも px / % なので、数えても寄せ先が無い
if (property === "border-radius" && /^(50%|9{2,4}px)$/.test(value.trim())) return false;
```

3点が同時に壊れている。

1. **理由が嘘。** 寄せ先は同じコミットで作った `$radius-pill` / `$radius-circle` に存在する
2. **`50%` の分岐は到達しない。** `RAW_LENGTH` が `rem|px|em` を要求するので
   `border-radius: 50%;` は `:51` で先に `false` を返す。正規表現の `50%` は死んだ分岐
3. **`9{2,4}px` が `99px` にも当たる。** `SettingsTabButton.scss:73` の `99px` は
   pill でも円でもない普通の直値だが免除されている

結果として `999px` / `99px` の**37宣言**が対象外になり、`border-radius: 999px;` を何行足しても落ちない。
このガードは「新しい直値を止める」ことだけが存在理由なので、穴が誤った理由で正当化されているのは
このコミットの主張そのものを崩す。

直し方: 除外を消して baseline 128 を実測値へ上げ直す（除外をやめる方向なので一度上がるが、
以後は下げるだけの運用に戻る）。残すなら理由を実態に書き換え、`50%` を正規表現から削る。

- 結果: 対応済み（`6269e9c`）。除外を削除し、角丸だけ `%` も直値として見るようにした。
  baseline 128 → **176**。差の48件は `50%` 11 / `999px` 33 / `9999px` 3 / `99px` 1 と一致する
  （**報告書の「37件」は `50%` を含まない数え方だった。実数は48**）。
  プローブで `border-radius: 50%` が検出されることを確認。同時に
  `.a { border-radius: 999px; }` の**1行ブロックは素通りする**ことも実証され、下の
  [MEDIUM]「行の形」が本物であることが裏付けられた

---

### [HIGH] グローバルリセットと `body` の基準を、どのエントリも import していない

- reviewer: `architecture`
- 場所: `src/index.scss:80-109`、`src/main.tsx`、`index.html`

`index.scss` を TS/TSX から import している箇所は**0件**（確認済み）。`index.html` も CSS を link していない。
`body { font-size: $font-body }` が画面に届いている経路は、**92個のコンポーネント SCSS が
`@use "@/index.scss" as index;` した副作用**だけ。

責務が逆向きに置かれている。ADR の「得られるもの」1点目（コンポーネントは `font-size` を書かなくてよい）は、
下位ファイルの副作用に支えられている。将来 `index.scss` をトークンのみに分割した瞬間、
リセットと基準がどこからも出力されなくなり、全画面が 10px 継承に戻る。**import 元が無いので lint も build も落ちない。**

直し方: `:80-109`（`*` リセット / `html` / `body` / スクロールバー）を `src/app/styles/global.scss` に移し、
`src/main.tsx` で import する。`index.scss` は CSS 出力ゼロの純粋なトークンモジュールになり、
**92行の `@use` は書き換え不要**。

- 結果: 対応済み（`83b234e`）。import 元は `main.tsx` ではなく `src/app/App.tsx`（既に `./App.scss` を
  import しており、app 層で読むのが素直）。`global.scss` を `App.scss` より前に置いた。
  `@use` している SCSS は**81ファイル**（報告書の92は概数）で、書き換えは発生していない。
  ビルド後の CSS に `font-size:62.5%` と `body{…font-size:1.3rem…}` が出力されることを確認。
  **なお「各チャンクに複製される」という副次的な指摘は、CSS のサイズが前後とも 132.26 kB で
  変わらないため、実害としては確認できなかった**（minifier が既に潰していた）。
  この修正の価値は出力量ではなく、到達経路が明示になったこと

---

### [HIGH] `body` への基準追加は既存画面を今すぐ変えるが、ADR は逆のことを書いている

- reviewer: `robustness`（`ui` `comment` が同一箇所を別の粒度で指摘）
- 場所: `src/index.scss:95`、`docs/decisions/0003-scss-scale-tokens.md:137`

ADR「諦めるもの」は **「整合するのは新しく書く箇所だけ」** と書いており、既存は変わらないと読める。
実際には `font-size` を1つも宣言していない SCSS が **97本中23本**あり、そこが 10px → 13px になる。

`ui` が具体的に挙げた変化箇所:

| 場所                                                             | 変化                                                                                          |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `widgets/app-layout-header/ui/AppLayoutHeader.scss:100,108,113`  | `__meta` / `__meta-name` / `__meta-sep`                                                       |
| `widgets/file-tree/ui/RootNode.scss`                             | サイドバーのルートフォルダ名                                                                  |
| `features/settings/ui/tabs/EngineTab.scss:44,219`                | `__loading` / `__muted`                                                                       |
| `features/position-search/ui/PositionSearchContinuation.scss:15` | `&__body`                                                                                     |
| `pages/WelcomeScreen.tsx:14`                                     | `weelcome-screen__title` は**綴り誤りでどの定義にも当たらず**、UA の `1.5em` で 15px → 19.5px |

**`ui` は「入りきらなくなる箇所は見つからなかった」と報告している**（固定 `height` を持つルールを全件走査し、
テキストを持つものは無し。`Hand.scss` の `em` はコンテナ幅従属で `body` の影響を受けない）。
つまり崩れではなく、**記述と実態の食い違い**が問題。

直し方: ADR の「諦めるもの」に影響を明記する。この1行を別コミットに分け、実際に画面を見た旨を残す。

---

### [HIGH] 既存3方式が、ラチェットの無制限の抜け道になっている

- reviewer: `robustness`（`architecture` が混在宣言の側から同旨）
- 場所: `src/__tests__/scssScaleRatchet.test.ts:53`

```ts
if (/[$]|var\(/.test(value)) return false;
```

**いずれもこの repo に実在する書き方**なので、次に書く人はコピー元に困らない。

```scss
// 1) ローカル変数（SettingsPanel.scss:3-4 と同じ形）
$size: 1.37rem;
.a {
  font-size: $size;
}
// 2) カスタムプロパティ（AnalysisPane.scss:10-11 と同じ形）
.a {
  --s: 1.37rem;
  font-size: var(--s);
}
// 3) mixin 引数（IconButton.scss:7,47 と同じ形）
@mixin size($f) {
  font-size: $f;
}
.a {
  @include size(1.37rem);
}
```

混在も素通りする。`padding: 0.25rem var(--pane-px) 0.4rem;`（`CandidatesSection.scss:6`）と
`padding: 0.35rem var(--pane-px) 0.15rem;`（`BestMoveSection.scss:4`）が現に数えられていない。

**ADR は `features/settings` のローカル `$radius-sm` を「スケールが要る証拠」として引いておきながら、
その方式をガードが恒久的に許可している。**

直し方: `$name:` / `--name:` の定義行も走査対象に入れる（`src/index.scss` は除外）。
混在は行内から `$xxx` と `var(...)` を除去したうえで `RAW_LENGTH` を掛ける。

- 結果: 対応済み（`cecc969`）。**下の [MEDIUM]「行の形」と同じ欠陥なので1コミットにまとめた**
  （走査が宣言を取りこぼすという1つの defect を、2人が別角度から記述したもの）。
  宣言単位の走査に変え、`indirect` の枠（変数 / カスタムプロパティ / mixin 引数）を追加。
  **実装中に自分でバグを1つ入れた**: コメントを潰さずに宣言を切り出したため、
  コメントの直後の宣言を落として `font-size` が 253 → 251 と減った。
  `blankComments` を足して 254 に戻した（旧走査より +1）。
  報告書が挙げた7つの抜け道を全てプローブで確認:

  | プローブ                                       | 結果               |
  | ---------------------------------------------- | ------------------ |
  | `$probe-size: 1.37rem;`                        | `indirect` +1      |
  | `--probe-var: 1.37rem;`                        | `indirect` +1      |
  | `@include probe-mixin(1.37rem)`                | `indirect` +1      |
  | `.probe-c { font-size: 1.37rem; }`             | `font-size` +1     |
  | `.probe-d { FONT-SIZE: 1.41rem }`              | `font-size` +1     |
  | `padding:` 折り返し + `index.$space-2 1.43rem` | `spacing` +1       |
  | `&:hover { border-radius: 0.77rem; }`          | `border-radius` +1 |

  baseline: font-size **254** / border-radius **179** / spacing **527** / indirect **54**

---

### [HIGH] `toBeLessThanOrEqual` なので、ファイル削除で開いた枠に後から直値を入れられる

- reviewer: `robustness`
- 場所: `src/__tests__/scssScaleRatchet.test.ts:105`

`BoardPreview.scss`（font-size 5件）を1本消すだけで枠が5つ空き、その後5件の新規直値を書いても緑のまま。
直値をトークンへ寄せたときも同じで、**下げ忘れを検出する仕組みが無い。**

直し方: `toBe(BASELINE[bucket])` にする。**現在値は BASELINE と完全一致するので変更コストはゼロ。**
減ったときも落として「基準値を N に下げてください」と出せば、下げ忘れが構造的に起きなくなる。

- 結果: 対応済み（`2eb369a`）。`BoardPreview.scss` から `font-size` を1件消すプローブで
  253 → 252 で落ちることを確認。失敗メッセージに「減ったなら BASELINE を N に下げること」を出すようにした

---

### [HIGH] 失敗メッセージが常に既存行を指し、しかも ADR が「載せない」と明言した駒台を指す

- reviewer: `robustness`
- 場所: `src/__tests__/scssScaleRatchet.test.ts:82-86`、`docs/decisions/0003-scss-scale-tokens.md:79-80`

`samples[bucket].length < 5` は走査順で先に埋まるので、**新しく書いた違反行は絶対に表示されない。**
実際に出るのは:

```
src/entities/position/ui/BoardPreview.scss:141  font-size: 0.75rem;   ← &__hand-label
src/entities/position/ui/BoardPreview.scss:169  font-size: 0.625rem;  ← &__hand-empty
```

ADR §3 が「盤の駒台（0.62rem / 0.75rem）はスケールに載せない」と明記した当の行に対して、
メッセージは「`src/index.scss` のトークンを使うこと」と指示する。**素直に従うと ADR 違反になる。**

`comment` が同じ構造を別方向から指摘: 駒台の2行は baseline 253 に含まれ「減らすべき負債」として数えられているので、
baseline を下げる作業者が `0.75rem` → `$font-hint`（1.1rem）に寄せると件数は減ってテストは通り、
**駒台の文字だけ約1.5倍になる。**

直し方: 駒台をカウントから除外して baseline を下げる。または BASELINE をファイル単位の
`Record<string, number>` にして増えたファイルだけ表示する（[HIGH] の枠問題も同時に消える）。

---

### [HIGH] `$radius-sm/md/lg` がファイルローカル変数と同名・別値で、機械的な移行が無言で見た目を壊す

- reviewer: `architecture` / `ui` / `comment`（**3人が独立に指摘**）
- 場所: `src/index.scss:44-47`、`features/settings/ui/tabs/EngineTab.scss:1-6,241`、`features/settings/ui/SettingsPanel.scss:3-4`

|              | ローカル | グローバル（新設） |
| ------------ | -------- | ------------------ |
| `$radius-sm` | 12px     | 0.6rem = **6px**   |
| `$radius-md` | 14px     | 0.8rem = 8px       |
| `$radius-lg` | 16px     | 1rem = 10px        |

名前空間が違うのでコンパイルは通り、lint も落ちない。`EngineTab.scss` の中では `$radius-md` が 14px、
`index.$radius-md` が 8px と、**同じ名前が同じファイル内で2つの値を持つ**。

CONTRIBUTING は「`index.$radius-md` を使え」と指示するので、移行時に `$radius-sm` → `index.$radius-sm` の
機械的置換が起きると角丸が**半減する**。しかも置換前後どちらも `$` を含むのでラチェットの件数は動かず、`verify` は通る。

`architecture` の対応表: 12px → `index.$radius-xl`、16px → `index.$radius-2xl`、**14px は段外**。
つまり**ローカルの "sm" はグローバルの "xl"**。

同種の同名別値が他にもある: `SButton.scss:4 $radius: 10px` と `SSection.scss:4 $radius: 14px`。

直し方（**提案が割れている。判断が要る**）:

- `architecture` / `comment`: ローカル側を `$settings-radius-*` / `$panel-radius-*` に改名（置換範囲が2ファイル内で最も安い）
- `ui`: グローバル側を `$radius-1`…`$radius-6` に改名（`$space-N` と命名方針が揃い、ADR §4「役割名を付けない」とも整合）

---

### [HIGH] motion / mono / elevation の新2段は、利用箇所ゼロかつラチェット対象外

- reviewer: `architecture` / `ui`（`comment` が注釈の誤りとして同旨）
- 場所: `src/index.scss:30,53-57,67-68`、`src/__tests__/scssScaleRatchet.test.ts:7`

新設トークンの使用回数は全て0（`$shadow-1` は4件、`$shadow-press` は9件と対照的）。
そして `SCALED_PROPERTIES` は `box-shadow` / `transition` / `font-family` を含まない。

**ADR の「規約だけにしない理由」は「`$default-font-size` を定義して誰も使わなかった実績がある」であり、
その対策がラチェットである。** ところが motion / mono / elevation にはその対策が及ばず、
「定義されているだけで使用箇所0」が新たに5個増えた。

さらに除外の理由付けが自分のコードと矛盾する。`isRawDeclaration` は
`padding: 0.6rem 0.8rem` のような複合値を既に判定できており、同じ規則は
`box-shadow: 0 2px 4px rgba(...)`（実測33件）にそのまま効く。**「複合だから判定できない」は
`box-shadow` については成立しない。** `transition` が対象外になる本当の理由は
`RAW_LENGTH` が `ms|s` を見ないこと。

直し方: `box-shadow` を `SCALED_PROPERTIES` に足す（既存ロジックで動く）。`transition` は
`RAW_LENGTH` に `s|ms` を足して別バケツにする。やらないなら ADR の「諦めるもの」に正直に書く。

---

### [HIGH] ADR が保留した決定の落とし先が、gitignore 済みのローカルファイルを指している

- reviewer: `oss-hygiene`
- 場所: `docs/decisions/0003-scss-scale-tokens.md:103`、`CONTRIBUTING.md:214-216`、`.gitignore:33`

ADR §5 の「→ `.claude/handoffs/error-display-foundation.md` の後に回す」は、
**`.claude/handoffs/` が gitignore されていて `git ls-files` が空**なので、clone した誰にも解決できない。

3重に効いている。

1. `docs/decisions/` は append-only の永続記録なのに、唯一「次にどこで決まるか」を示す行が追えない
2. `CONTRIBUTING.md` は外部コントリビュータを #160 に誘導するが、**#160 の本文自身が
   `.claude/handoffs/` を「決めるのはこちら側」として指している。** 指示どおり辿ると必ず行き止まる
3. **#160 の本文の実測値（font-size 43種 / border-radius 17種）は ADR-0003（55種 / 40種）と食い違う。**
   数え直した結果 ADR 側が正しい。外部の人は誘導先で古い数字を読む

直し方: 意味色の未決を `docs/OPEN-QUESTIONS.md` に Q-005 として起こし、ADR の参照先をそれに差し替える。
`OPEN-QUESTIONS.md` に載れば週次レビューの入力2に自動で乗る。**現状はどの入力にも乗らないので、
この保留は誰にも拾われない。**

---

### [MEDIUM] 行の形を変えるだけで検出を外せる。SCSS のフォーマッタが無いので形は矯正されない

- reviewer: `robustness`
- 場所: `src/__tests__/scssScaleRatchet.test.ts:73`

同じロジックに食わせて確認した結果、以下は**全て0件**として通る。

```scss
.a {
  font-size: 1.37rem;
} // セレクタと同じ行
.a {
  &:hover {
    font-size: 1.5rem;
  }
} // 1行ブロック
.a {
  padding: 1.37rem 2rem;
} // 値が次行
.a {
  font-size: 1.37rem;
} // 末尾セミコロン無し
.a {
  font-size: 1.37rem;
} // 大文字（[a-z-]+ が外れる）
.a {
  font-size: #{1.37}rem;
} // 補間
.a {
  font-size: 1.37rem;
  border-radius: 0.7rem;
} // 1行2宣言 → 2件目を落とす
```

直し方: 行単位でなくファイル全体を `content.split(/[;{}]/)` で宣言単位に切ってから当てる。
プロパティ名は `toLowerCase()` する。1行2宣言も自動的に両方拾える。

- 結果: 対応済み（`cecc969`）。上の [HIGH]「抜け道」と同じ欠陥なので同じコミットで直した。
  **補間 `#{1.37}rem` は依然として検出しない**（値を評価しないと単位が現れないため）。
  実測で使用例は0件。ラウンド2の対象

---

### [MEDIUM] 負値が lookbehind で丸ごと落ちる。既存コードに実例がある

- reviewer: `robustness`
- 場所: `src/__tests__/scssScaleRatchet.test.ts:48`、`shared/ui/Form/TagsInput.scss:136`、`widgets/boot-splash/ui/BootSplash.scss:68`

`margin: -0.2rem;` は `0.2rem` の直前が `-`、`.2rem` の直前が `0`、`2rem` の直前が `.` で全位置が不一致。
`TagsInput.scss:136` の `margin: -0.2rem` と `BootSplash.scss:68` の `margin: -1px` は今も数えられていない。
**マイナスを付ければ通るという抜け道が既に踏まれている。**

---

### [MEDIUM] `1.4rem` / `1.8rem` / `2rem` は 0.2rem 刻みに乗っているのに段が無い

- reviewer: `ui`
- 場所: `src/index.scss:34-49`

| 値       | 実測     | 主な場所                                                                                                   |
| -------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `1.4rem` | **51回** | `pages/AppLayout.scss:77`、`shared/ui/Modal.scss:206,215`、`widgets/kifu-stream/ui/KifuStreamList.scss:17` |
| `1.8rem` | 16回     | `PositionNavigationHeader.scss:20`、`PresetDialogHeader.scss:5`                                            |
| `2rem`   | 18回     | `StudyPositionsManagerModal.scss:13`、`StudyPositionSaveModal.scss:13,36`                                  |

ADR は「乗っていない値をその刻みに寄せる」と書いているが、**刻みに乗っている値のほうが段から漏れている。**
ダイアログ／モーダルの外殻は揃って `1.4rem` の角丸で、寄せ先が 1.2 と 1.6 のどちらにも倒せるため、
**同じ役割の外殻が寄せ先の判断次第で割れる。** ラチェットの「下げる方向にだけ」運用の下では、
寄せた瞬間にその割れが固定される。

直し方（**両論。判断が要る**）: 段に 1.4 / 1.8 / 2.0 を足して 2.4rem まで欠けなく張るか、
ADR に「1.4 は 1.6 に倒す」と寄せ先を一意に明記するか。

---

### [MEDIUM] `$shadow-overlay` の値が実在するどのポップオーバーとも一致しない

- reviewer: `ui`
- 場所: `src/index.scss:65-72`

`$shadow-overlay`（blur 12px / alpha 0.15）の使用箇所は定義行以外に0件。実在するポップオーバーは:

| 場所                                             | 値                           |
| ------------------------------------------------ | ---------------------------- |
| `widgets/kifu-stream/ui/KifuForkMenu.scss:28-31` | blur 56px / alpha 0.55 + 2段 |
| `widgets/file-tree/ui/ContextMenu.scss:8-10`     | blur 30px / alpha 0.45       |
| `widgets/file-tree/ui/NodeBox.scss:81-83`        | blur 16px / alpha 0.28       |

**実在のものより一段も二段も弱い。** 「何が浮いているかで選ぶ」に従って新しいポップオーバーに当てると、
隣に出る分岐メニューと明らかに違う浮き方になる。

`$shadow-raised` も明るい背景のフォーム部品（`TagsInput.scss:39`）から取った値で、暗い面のカードでは
ほぼ見えない。`$shadow-1 // モーダル` のコメントも、実際の4件中3件は非モーダル
（`KifuStreamList.scss:18` の棋譜ペイン、`GameControls.scss:14`、`FloatingNote.scss:25`）。

---

### [MEDIUM] `<button>` / `<input>` / `<select>` は UA スタイルが優先するので `body` の基準を継承しない

- reviewer: `ui`
- 場所: `CONTRIBUTING.md`（「本文サイズなら `font-size` を書く必要はありません」）

kit 側は `font: inherit` で回避しているが（`SInput.scss:10`）、`.stab`（`SettingsTabButton.scss:19`）と
`.kifu-forkmenu__item`（`KifuForkMenu.scss:65`）には無い。`.kifu-forkmenu__check` の「✓」は
今も UA 既定（13.333px / Arial）で描かれ、`body` の変更後も変わらない。

**この文言に従って新しい `<button>` を書くと、隣の `<div>` は 13px の Noto Sans JP、
ボタンは 13.333px の Arial という差が黙って入る。**

直し方: `src/index.scss` のリセットに `button, input, select, textarea { font: inherit; }` を置く。
規約文で注意喚起するより機械で済む。

---

### [MEDIUM] `src/__tests__/` はレイヤ規則の適用範囲の外にある

- reviewer: `architecture`
- 場所: `src/__tests__/scssScaleRatchet.test.ts`、`vite.config.ts:24-52`

`layerBoundaries` は `files: ["src/${layer}/**/*.{ts,tsx}"]` で6レイヤにしか当たらない。
既存テストは全て `src/<layer>/<slice>/__tests__/` にあり規則の下にいる。

**今回のファイル自体の違反はゼロ**（`node:fs` / `node:path` / `vitest` のみ）。問題は前例になること。
次の横断ガードをここに足すと `@/app/**` でも `@/shared/**` でも無制限に import でき、lint は落ちない。

直し方: リポジトリルートの `tests/` に出して `@/` エイリアス空間から外すか、
`vite.config.ts` の overrides に `src/__tests__/**` を足して全レイヤ import を禁止する。

---

### [MEDIUM] ADR-0002 の欠番の理由がリポジトリのどこにも残っていない

- reviewer: `oss-hygiene`
- 場所: `docs/decisions/`、`docs/OPERATING-MODEL.md:36`

`946a47e` で `0002-drop-book-read-write.md` が追加され、`0b3dff1` でファイルごと削除、
同コミットで `LOG.md` の 0002 の行も**上書き**されている。

**番号を 0003 に飛ばしたこと自体は正しい**（0002 を再利用すると当時 close された17件の issue と
コミットメッセージ中の「ADR-0002」が別の決定を指すことになる）。問題は**飛んだ理由がどこにも無い**こと。
`docs/decisions/` を開いた人は 0001 と 0003 しか見えず、書き忘れか撤回か判断できない。
これは `OPERATING-MODEL.md:36` の append-only 規律の違反が既に一度起きたことを意味し、
**このブランチが 0003 を足すことでその状態を固定する。**

直し方: `0002` を復元して `- 状態: 撤回（2026-08-29、判断の軸を P-008 に置き直したため）` に変え、本文は書き換えない。
そこまでしないなら `docs/decisions/README.md` に2行残す。撤回は `main` 側で起きたことなので別 issue でも可。
**どちらか選ぶこと。放置しない。**

---

### [MEDIUM] `LOG.md` の新しい行が同じ日付の既存行と矛盾し、前提の状態も事実と違う

- reviewer: `oss-hygiene`
- 場所: `docs/decisions/LOG.md:3,10,11`、`docs/PREMISES.md`

1. 同じ 2026-08-29 に2行あり、`LOG.md:3` の「1回1行」とも
   `OPERATING-MODEL.md:16` の「1サイクル1件」とも突き合わせられない
2. **「前提: 点検なし」は実態より悪く書いている。** `PREMISES.md` の `次回確認` は
   P-002=2026-10、P-005=2027-01、残りは事象トリガで、**2026-08-29 時点の期限切れは0件**。
   確認した結果0件だったのであって、飛ばしたわけではない

直し方: 前提欄を `前提: 期限切れなし（次回確認は P-002 の 2026-10 が最短）` に直す。
行を分けたままにするなら `2026-08-29（サイクル外）` と明示する。

---

### [MEDIUM] `.tsx` のインライン style が対象外であることが ADR にも CONTRIBUTING にも書かれていない

- reviewer: `robustness`
- 場所: `docs/decisions/0003-scss-scale-tokens.md:129-140`、`CONTRIBUTING.md`、`features/create-file/ui/KifuImportForm.tsx:97,101,103,105,107,132`、`shared/ui/AppErrorBoundary.tsx:40,55`

ADR の「得られるもの」は「直値が増えたら `npm run verify` が落ちる」と書くが、
`style={{ fontSize: "1.3rem" }}` は落ちない。`style={{` は `src/**/*.tsx` に**44箇所**ある。
ADR / CONTRIBUTING のどちらにも `inline` / `style=` / `tsx` の語が1つも無い（grep 0件）。

`KifuImportForm.tsx:97` の値はちょうど `$font-body` と同値で、**片方はトークン・片方はハードコードという
二重管理が今この瞬間に成立している。**

---

### [MEDIUM] `CONTRIBUTING.md` が同じ章の中で `@use` を「こう書く」と「未決」の両方で扱っている

- reviewer: `oss-hygiene`
- 場所: `CONTRIBUTING.md:184-185` と `:218`

34行離れた同一章で、同じ対象について「`@use "@/index.scss" as index;` で読み込みます」と
「`@use` の書き方も未決です」が並ぶ。外部の人は従ってよいのか待つのか判断できない。

実測では `@/index.scss` 72件 / `@/index` 7件 / `../index.scss` 2件で、**多数派は既に前者。**
未決なのは書き方ではなく、残り9件を機械的に揃えられるかだけ。

---

### [MEDIUM] 「基準値は下げる方向にだけ」の手順が無く、下げるべき数を知る方法が読み手に無い

- reviewer: `comment`
- 場所: `CONTRIBUTING.md:204-210`、`src/__tests__/scssScaleRatchet.test.ts:31-35`

現在値を出す手段が「テストが落ちたときのメッセージ」しか無い。**直値を減らした側は必ずテストが通るので、
新しい件数はどこにも表示されない。** 編集すべき定数名（`BASELINE`）とその場所も CONTRIBUTING に書かれていない。

結果として baseline が据え置かれ、ラチェットが「増やさない」だけの装置に劣化する。

---

### [MEDIUM] `$font-body-lg` だけがサイズで選ばせる名前になっている

- reviewer: `comment`
- 場所: `src/index.scss:22`、`docs/decisions/0003-scss-scale-tokens.md:65-66`

他の7段は名前だけで用途が引けるが、`body-lg` は `body` との差が「大きい方」でしか表現されていない。
**ADR §3 が「サイズ名だと選択がサイズ勘に戻る」と書いた当のリスクが、この1段に残っている。**

直し方: 行末コメントの役割をそのまま名前にする（`$font-lead` か `$font-control-lg`）。

---

### [MEDIUM] `$shadow-1` だけ役割名でなく、直上のコメントがその場で破られている

- reviewer: `comment`
- 場所: `src/index.scss:65-72`

「段は浮き上がりの高さでなく、何が浮いているかで選ぶ」と書いた直後に、
何が浮いているか名前から分からない `$shadow-1` が並ぶ。新しい段を足す人は `$shadow-2` へ誘導される。
使用箇所は5件なのでリネームは安い。

---

### [MEDIUM] 対象プロパティの取りこぼし

- reviewer: `robustness`
- 場所: `src/__tests__/scssScaleRatchet.test.ts:9-25`

論理プロパティ（`padding-inline` / `padding-block` / `margin-inline` …）と
`font:` ショートハンドが `SCALED_PROPERTIES` に無い。**現状 repo に使用例が無いので、
足してもカウントは0増で baseline を触らずに済む。**

---

### [MEDIUM] ADR §4 の角丸の記述がトークン定義と一致しない

- reviewer: `comment`
- 場所: `docs/decisions/0003-scss-scale-tokens.md:88`、`src/index.scss:44-49`

`$radius-xs`…`$radius-xl` は5つだが値は6つ並んでおり、実際の最上段は `$radius-2xl: 1.6rem`。
`CONTRIBUTING.md:180` はこの ADR を唯一の根拠として指すので、ADR だけを読んだ人は
`$radius-2xl` の存在を知らないまま 1.6rem を直値で書く。§1 の「pill（`999px` / `9999px`）」も
定義されているのは `999px` だけ。

---

### [MEDIUM] 駒台をスケールに載せない理由が、駒台のコードから読めない位置にしかない

- reviewer: `comment`
- 場所: `src/index.scss:28`、`entities/position/ui/BoardPreview.scss:141,169`

除外の宣言（`index.scss:28`）が、除外を守らせたい場所（`BoardPreview.scss`）に届いていない。
[HIGH]（失敗メッセージが駒台を指す）と同じ根を持つ。

---

### [MEDIUM] `CLAUDE.md` の SCSS の記述がトークン導入前のまま

- reviewer: `oss-hygiene`
- 場所: `CLAUDE.md:67`

`OPERATING-MODEL.md:41` により `CLAUDE.md` はエージェント向け制約の唯一の置き場で、
このリポジトリの SCSS を実際に書いているのは大半がエージェント。67行目は読み込み方しか言っておらず、
**「直値でなく用途名トークンから選ぶ」という ADR-0003 の中心が届かない。**

さらにラチェットは件数だけを見るので、**既存の直値を1件寄せて別の場所に1件足す変更は素通りする**（等量の入れ替え）。

---

### [MEDIUM] `OPERATING-MODEL.md` の例示行が実在するようになった ADR-0003 と衝突している

- reviewer: `oss-hygiene`
- 場所: `docs/OPERATING-MODEL.md:73`

```
2026-08-03 | 決定: ADR-0003 注釈は系統B採用 | Now: #113 継続 | 前提: P-006 未確認のまま
```

このブランチまで「ADR-0003」は架空の番号だったので無害だった。今は実在し、内容は SCSS スケール。
`grep -rn "ADR-000"` を打つと「ADR-0003 = 注釈は系統B採用」と読める形で返る。
注釈の系統A/B は `OPEN-QUESTIONS.md` の Q-001 として**🔴 未決のまま**なので、誤読の余地が実在する。

---

## 重複・矛盾した所見

### 3人以上が独立に指摘した箇所

| 箇所                                         | reviewer                                         | 統合後の深刻度 |
| -------------------------------------------- | ------------------------------------------------ | -------------- |
| ラチェットの `border-radius` 除外            | `comment`(BLOCK) / `architecture` / `robustness` | **BLOCK**      |
| `$radius-sm/md/lg` の同名別値                | `architecture` / `ui` / `comment`                | **HIGH**       |
| motion / mono / elevation がラチェット対象外 | `architecture` / `ui` / `comment`                | **HIGH**       |
| `body` の変更と ADR の記述の食い違い         | `robustness`(HIGH) / `ui` / `comment`            | **HIGH**       |

### 互いに矛盾する提案（**判断が要る**）

1. **`$radius-*` の同名衝突をどちらで解くか**
   - ローカル側を改名（`architecture` / `comment`）— 置換範囲が2ファイル内。安い
   - グローバル側を `$radius-1`…`$radius-6` に改名（`ui`）— `$space-N` と揃い、ADR §4「役割名を付けない」と整合。
     ただし CONTRIBUTING と ADR の記述も全部追従が要る

2. **`1.4rem` を段に足すか、寄せ先を明記するか**（`ui`）
   - 段に 1.4 / 1.8 / 2.0 を足す — 51件が寄せ先を得るが、8段の主張が崩れる
   - ADR に「1.4 は 1.6 に倒す」と書く — 段は保つが、モーダル外殻の見た目が変わる

3. **`src/__tests__/` の置き場**（`architecture`）
   - `tests/` に出して `@/` 空間から外す
   - `src/` に残して `vite.config.ts` に override を足す

---

## 見ていない範囲

- **実際にアプリを起動しての描画確認は誰もしていない。** `ui` の「入りきらない箇所は無い」は
  `src/**/*.scss` の固定寸法ルールと `em` 使用箇所を全件走査した**静的な確認**であって、レンダリング結果ではない
- `docs/decisions/0003` の実測表のうち、`oss-hygiene` が再計算して一致を確認したのは
  55種 / 40種 / 45種 / 21種と baseline の3値。**役割別の段数（`__title` 13種など）と
  各段の吸収件数は誰も再計算していない**
- シンボリックリンクの扱いは実試験していない（`entry.isDirectory()` が symlink で `false` を返す一般論まで）
- `src-tauri/` と `.tsx` のロジック・フックは差分に含まれないため未確認
- `docs/decisions/LOG.md` の1行は `oss-hygiene` のみが見ている
- `.claude/handoffs/` 配下の中身は誰も読んでいない（非追跡のため）

---

## lint / hook で強制できるもの

**今回のガードと同じ方式（fs 走査 + 正規表現、依存追加なし）で機械化できるもの:**

| 対象                                       | 手当て                                                                                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 基準値の下げ忘れ／削除で開いた枠           | `toBe` への1文字変更。**現在値が baseline と一致しているので今なら無料**                                                                                      |
| 失敗メッセージが自分の行を指さない         | BASELINE をファイル単位の `Record<string, number>` に                                                                                                         |
| `transition` / `box-shadow` の直値         | `SCALED_PROPERTIES` に追加、`RAW_LENGTH` に `s\|ms`                                                                                                           |
| `.tsx` のインライン style（44箇所）        | 同じテストに別バケツ                                                                                                                                          |
| SCSS の深い相対 `@use`                     | `widgets/game-board/ui/Square.scss:1` に1件。`no-restricted-imports` は `.scss` を見ない                                                                      |
| `@use` の書き方の統一（9件が非多数派）     | 同上                                                                                                                                                          |
| **トークン定義の使用箇所ゼロ検出**         | `index.scss` の `$name` を集めて参照数0を列挙。**`$default-font-size` の再発をこれで防げる**                                                                  |
| ローカル変数とグローバルトークンの同名衝突 | `index.scss` のトークン名と同名のファイルローカル定義を禁止                                                                                                   |
| `docs/decisions/` の欠番                   | 欠番があれば `README.md` に理由の行を要求                                                                                                                     |
| `LOG.md` の行の形式と日付重複              | 正規表現1本                                                                                                                                                   |
| 未定義クラス名                             | `weelcome-screen__title` / `.empty` / `.board-preview-placeholder` / `.stats-section__item--label` が実在。`.tsx` の `className` と SCSS セレクタの突き合わせ |
| `<button>` などの `font` 未継承            | **lint でなく `font: inherit` の1行で構造的に消える**                                                                                                         |

**機械で防げないもの:** トークンの選択が用途に合っているか（ADR も明記済み）、影の強さが周囲と揃っているか、
`CLAUDE.md` / `OPERATING-MODEL.md` の記述の更新漏れ。

---

## 次ラウンドの対象

**この判断はユーザーが決める。以下は材料。**

### 直さないとこのコミットの主張が成り立たないもの

- BLOCK: `border-radius` 除外（37件が素通り + 理由が嘘 + 死んだ分岐）
- HIGH: `toBe` への変更（**今なら1文字。時間が経つほど高くつく**）
- HIGH: 失敗メッセージが駒台を指す（ADR と矛盾した指示を出している）
- HIGH: 抜け道3方式（実在する書き方なのでコピーされる）

### 記述と実態を合わせるもの（コードは変えない）

- HIGH: `body` の影響を ADR の「諦めるもの」に書く
- HIGH: ADR §5 の参照先を `OPEN-QUESTIONS.md` の Q-005 に
- MEDIUM: `.tsx` インライン style が対象外であること、`$radius-2xl`、`LOG.md` の前提欄

### 判断が要るもの（矛盾した提案がある）

- `$radius-*` の同名衝突をどちらで解くか
- `1.4rem`（51件）を段に足すか、寄せ先を明記するか
- `src/__tests__/` の置き場

### 見送ってよいもの

- HIGH: `index.scss` の分割（`main.tsx` からの import）— **正しいが、このコミットの主張とは独立。
  単独のコミットに切るほうが差分が読める**
- MEDIUM: ADR-0002 の欠番 — `main` 側で起きたことなので別 issue
- MEDIUM: `OPERATING-MODEL.md:73` の例示 — 別 issue
- MEDIUM: `$shadow-overlay` の値 — 使用箇所が0なので、最初の利用者が出るときに実測から取り直せばよい

---

## ラウンド1 の対応結果（一覧）

BLOCK 1件・HIGH 8件・MEDIUM 15件すべてを処理した。**見送りは0件。**

| 所見                            | 深刻度        | コミット  | 備考                                                                             |
| ------------------------------- | ------------- | --------- | -------------------------------------------------------------------------------- |
| `border-radius` 除外            | BLOCK         | `6269e9c` | 実数は37でなく**48件**だった                                                     |
| `index.scss` の import 経路     | HIGH          | `83b234e` | `main.tsx` でなく `App.tsx` から。CSS サイズは変わらず（複製の実害は確認できず） |
| `body` の影響と ADR の記述      | HIGH          | `0754bec` | 98本中24本                                                                       |
| ラチェットの抜け道              | HIGH          | `cecc969` | MEDIUM「行の形」と同一欠陥。7経路をプローブで確認                                |
| `toBeLessThanOrEqual`           | HIGH          | `2eb369a` | 減少側でも落ちることを確認                                                       |
| 失敗メッセージが駒台を指す      | HIGH          | `cadcf27` | `scale-exempt` を宣言の場所に置く形で解決                                        |
| `$radius-*` の同名別値          | HIGH          | `8f82d0f` | ローカルを `$settings-radius-*` に。**再発を検査で止めた**                       |
| motion / elevation が対象外     | HIGH          | `4927527` | 枠を6つに                                                                        |
| ADR の参照先が gitignore        | HIGH          | `344a9f0` | Q-005 を新設                                                                     |
| 欠けた段（1.4 / 1.8 / 2.0rem）  | MEDIUM        | `b1e501b` | ユーザー判断: 段を足す                                                           |
| 負値                            | MEDIUM        | `5a77a6e` | spacing +2 / elevation +2                                                        |
| 論理プロパティ                  | MEDIUM        | `2e08eae` | 使用0件なので基準値は不変                                                        |
| `<button>` の `font` 未継承     | MEDIUM        | `5b7a5f2` | リセットで構造的に解決                                                           |
| 影の値と `$shadow-1` の名前     | MEDIUM ×2     | `e1390f4` | `$shadow-raised` は利用者0なので削除                                             |
| `$font-body-lg`                 | MEDIUM        | `89a4d87` | `$font-lead` に                                                                  |
| CONTRIBUTING 4件                | MEDIUM        | `32b7799` | 下げ方 / inline style / `@use` / pill                                            |
| CLAUDE.md・OPERATING-MODEL・LOG | MEDIUM ×3     | `5d821ca` |                                                                                  |
| `src/__tests__` の置き場        | MEDIUM        | `ee70877` | 移動でなく override。プローブ済み                                                |
| ADR-0002 の欠番                 | MEDIUM        | `1077d6d` | 状態を撤回にして復元                                                             |
| `weelcome-screen__title`        | HIGH-2 の付随 | `8ea6ec9` |                                                                                  |

### レビュアーの指摘のうち、数え直して訂正したもの

- `border-radius` 除外の件数: 報告書 37 → 実数 **48**（`50%` 11件を含む）
- `@use` しているファイル数: 報告書 92 → 実数 **81**
- `index.scss` の複製: **CSS のサイズは前後とも 132.26 kB で、実害は確認できなかった**

### 実装中に自分で入れて自分で見つけた不具合

宣言単位の走査に変えたとき、コメントを潰さずに切り出したため
コメント直後の宣言を落とし、`font-size` が 253 → 251 と**減った**。
「取りこぼしを減らす変更で件数が減る」のは矛盾なので気づけた。`blankComments` で修正。

### 最終的な基準値

font-size 252 / border-radius 179 / spacing 529 / elevation 80 / motion 84 / indirect 53
