# レビュー 436-error-boundary-layers ラウンド4

- 日付: 2026-09-09
- 範囲: `git diff origin/main...HEAD`（r1 24件 + r2 30件 + r3 24件の修正を含む）
- 走らせた reviewer: architecture / react / ui / robustness / comment / oss-hygiene
- 対象コミット: `cf621328` 系列
- 前ラウンド: [r1](2026-09-08-436-error-boundary-layers-r1.md) / [r2](2026-09-08-436-error-boundary-layers-r2.md) / [r3](2026-09-09-436-error-boundary-layers-r3.md)

## 所見

### [BLOCK] r4-01 `--floating` の2枚が同一座標・同一段で、両方畳まれると片方に触れない

reviewer: ui / robustness / architecture（3人が独立に）

- 場所: `src/shared/ui/AppErrorBoundary.scss` の `&--floating`、`src/app/App.tsx`（更新の知らせ）、`src/pages/AppModalLayer.tsx`（モーダル）
- 位置と段を決めているのは class 1つなので、**2枚とも `top` / `right` / `z-index` が同一値**。
  面は不透明（`$color-primary-black`）。同値なら DOM 順で決まり、後に来る**更新の知らせが必ず上に描かれる。**
- しかも更新の知らせの境界は `resetKeys` を持たないので、**一度畳むとそのセッションのあいだ枠を占め続ける。**
  その下に隠れたモーダル層の名乗りも `hint` も `再表示` も、読めず押せない。
- **r2-04 が挙げ、r3-02 が「位置を動かしただけ」で残した重なりが3ラウンド生き残っている。**
  SCSS の「避けるもの」の列挙に**もう1枚の `--floating`** が入っていない。

### [HIGH] r4-02 `--floating` の箱に閉じる手段が無い。`再表示` が効かない失敗では覆ったまま消えない

reviewer: ui

- 場所: `src/shared/ui/AppErrorBoundary.tsx` の既定の本文、`src/app/App.tsx`
- 更新の境界は `extraActions` も `fallback` も `resetKeys` も渡していない。`reset` は `error` を消すだけなので、
  `UpdaterScreen` が決定的に投げる限り押した直後に同じ行で落ち直す。**箱は自分から消えない。**
- 幅は子の `max-width: 60ch` で決まる shrink-to-fit なので 40rem 前後。
  1280×800 の実測算で `.workspace__kifuPane` の上から4〜5割を覆ったまま残る。
- `hint`「更新は次の起動時にもう一度知らせます。」は「無視してよい」と読ませる文なのに、
  **無視するための操作が画面に無い。** 位置を3回動かしても所見が出続けている根はここ。

### [HIGH] r4-03 契約「受け取ったものをそのまま渡すこと」を、唯一の `fallback` 実装が守れていない

reviewer: react / comment / architecture（3人）

- 場所: `src/shared/ui/AppErrorBoundary.tsx` の `fallback` の doc、`src/app/App.tsx`、`src/app/RootErrorFallback.tsx`
- `RootErrorFallback` の `Props` は `floating` を持たず、`AppErrorFallbackBody` にも渡していない。
  `fallback={(args) => <RootErrorFallback {...args} />}` は JSX スプレッドなので**余剰プロパティ検査が効かず、
  `args.floating` は黙って消える**（`npx tsc -b` が緑であることが実証）。
- **r3 の「lint / hook で強制できるもの」が書いた「`floating` は型で止まる」は成立していない。**
- 実際には root の fallback は自前の枠（`position: fixed; inset: 0`）を持つので `floating` は意味を持たない
  —— つまり**契約の文が広すぎる**。この文を素直に読んで2枚目の `fallback` を書く人は、
  枠を自前で持つ器の中で `position: fixed` の箱を出す形になる。

### [HIGH] r4-04 境界を層の中へ移したのに、その所在を書いた4箇所が古いまま

reviewer: comment / robustness / architecture / oss-hygiene（4人）

- 場所: `docs/spec/screens/app-layout.md` の表の行と「対象:」の列挙、`docs/spec/README.md`、
  `src/features/position-navigation/ui/PositionNavigationModal.tsx`
- 表は「`AppModalLayer` を包む（`AppLayout`）」のままだが、`AppLayout.tsx` に残る `AppErrorBoundary` は
  盤・棋譜一覧・解析の3枚だけ。境界は `AppModalLayer.tsx` にある。
- **この表は `App.tsx` と `failure-surfacing.md` が「ここに写さない」と名指しで委譲した唯一の出典。**
  `PositionNavigationModal` の doc を読んだ人が `pages/AppLayout.tsx` を開くと境界が3つ見つかり、
  そのどれもモーダル層のものではない。
- 誤読は既に伝播していて、issue #511 の表もこの節を出典として引いている。

### [HIGH] r4-05 `fallback` の契約 doc が、同じラウンドで改名して消えた prop 名（`actions` / `notice`）で書かれている

reviewer: comment / react / architecture（3人。comment は BLOCK 判定）

- 場所: `src/shared/ui/AppErrorBoundary.tsx` の `fallback` の doc と `AppErrorFallbackAction` の `onClick` の doc
- 実在する口は `extraActions` / `afterAction`。`notice` / `actions` は**同じファイルが「その名前にしない」と
  明文で退けた綴り**で、いま1つの綴りが3通りの意味を持っている。
- `notice` を grep すると当たるのは `notification/Notice.tsx` と「使わない理由」だけ。
  `fallback` を新しく書く人は「`Notice` を自分で組めということか」と読み、r3-17 が消そうとした
  手書きの箱がもう1つ増える。
- **原因は1ラウンド内の順序**: 順1 が `actions` / `notice` で doc を書き、順8 が改名した。

### [HIGH] r4-06 盤の `hint` が「棋譜を開き直してから」と言うが、その操作がツリーに無い

reviewer: robustness

- 場所: `src/pages/AppLayout.tsx`（盤の `hint`）、`src/widgets/file-tree/ui/FileNode.tsx`
- 盤が畳まれているとき、その棋譜は必ず `activeKifuPath` に入っている（`hasKifu` が偽なら盤は描かれない）。
  `FileNode` は `isActive` が真なら `openKifuNode` を呼ばないので、**ツリーで同じファイルをクリックしても何も起きない。**
- 実際に効くのは「別の棋譜を開いてから戻る」で、隣の棋譜一覧の `hint` はそう書いている。
  **同じ PR の中で、同じ操作を指す2つの案内が食い違っている。**

### [HIGH] r4-07 `conflict` / `kifuError` **自身**が落ちたときは、鍵に足しても出口にならない。`hint` が往復を作る

reviewer: robustness

- 場所: `src/pages/AppModalLayer.tsx`
- 鍵に足したことで解けるのは「原因が自然に消えたとき」だけ。その2枚が落ちる原因そのものであるときは、
  `hint`「別の操作からやり直してください」に従って歯車を押す → `location.key` が動いて解ける →
  `kifuError` はまだ非 null なので同じ行で落ちる → また畳む。**設定モーダルは一度も出ない。**
- 実際の出口は「ツリーで**別の**棋譜を開く」（`kifu_loading` が `kifuError` を落とす）だが、
  `hint` はそれを一言も言っていない。**案内が指す操作が、唯一の行き止まりを踏む操作になっている。**
- `clearKifuError` / `closeConflict` の呼び手は畳まれた側の2箇所だけ。

### [MEDIUM] r4-08 ボタンの綴り「再表示」が `hint` の5箇所に写され、出典と結ぶものが無い

reviewer: react / comment

- 場所: 出典は `AppErrorFallbackBody` のボタン。写しは `AppLayout.tsx` ×3 / `App.tsx` / `RuntimeShell.tsx`
- r3-04 の直しが `hint` 側に綴りを埋めた結果、出典1・写し5になった。ボタンの文言を変えると
  5枚の案内が**存在しないボタン**を名指しし、型でも lint でもテストでも赤くならない。
- ADR-0004 が「実装のボタンは以前から『再表示』」と別の綴り（「再読み込み」）との差を注記していて、
  揺れる余地が現に残っている。

### [MEDIUM] r4-09 `/`（ヘッダの無い画面）でも `--floating` がヘッダぶん下がる

reviewer: ui / comment / architecture

- 場所: `src/shared/ui/AppErrorBoundary.scss`、`src/app/App.tsx`
- 更新の知らせの境界は `<BrowserRouter>` の**外**にあり、`/`（`AppLoading` / `FolderSelect`）でも描かれる。
  そこには `TitleBar` も `.app-header` も無いのに、`top` は両方ぶん（9.4rem）空け、`max-height` も短くなる。
  `FolderSelect` の見出しに正面から重なる。
- 同じ状況を `NotificationLayer.scss` は「**帯が無い画面でもこのぶんを空ける**」と明記して受け入れているのに、
  こちらの根拠には断りが無く「ヘッダは常に在る」と読める。

### [MEDIUM] r4-10 `--floating` の「避けるもの」の根拠が2つ成り立たない

reviewer: comment

- 場所: `src/shared/ui/AppErrorBoundary.scss`
- (1)「ヘッダの右のアイコンは、この箱を消す鍵を動かす**唯一の**導線」が偽。鍵は `location.key` で、
  `updateParams` は必ず `navigate` する。畳まれている間も生きている導線が最低3つある
  （解析ペインのヘッダ、ツリーの行の操作、盤の向きのトグル）。
- (2) もう一方の利用者（更新の知らせ）には `resetKeys` 自体が無いので「この箱を消す鍵」が存在しない。

### [MEDIUM] r4-11 `location.key` を見るテストが1本も無い。鍵の主役を落としても全テストが緑

reviewer: react

- 場所: `src/pages/__tests__/AppModalLayer.test.tsx`
- 新しい2本は `rerender` に新しい `<MemoryRouter>` を渡しているが、`MemoryRouter` は history を
  `useRef` で保持するので**再マウントにならず `location.key` は同一値のまま**。
  つまりこの2本は `conflict` の変化だけを検証している。
- r3-10 の核心は「鍵を `location.key` に寄せる」ことだったのに、`key` を落とす変異はどのテストも赤くしない
  （他の3本は層ごとモックしている）。**r3-11 が `conflict` について塞いだ穴が、より効いている側に残っている。**

### [MEDIUM] r4-12 `AppModalLayer.test.tsx` の `stub.conflict` がリセットされず、テスト間で持ち越される

reviewer: react

- 場所: `src/pages/__tests__/AppModalLayer.test.tsx`
- `throwing.settings` は `afterEach`、2つの `vi.fn()` は `beforeEach` で戻るのに、`stub.conflict` はどちらにも無い。
- `stub.conflict` は**この PR が `resetKeys` に入れた値そのもの**で、持ち越しが「いま検証している機構の入力」に
  直接入る。`.only` を付ける・順序を変えるだけで描いている木が変わる。

### [MEDIUM] r4-13 `AppErrorFallbackAction` が「ログに残す」と書いているが、同じファイルがそのログは読めないと書いている

reviewer: react

- 場所: `src/shared/ui/AppErrorBoundary.tsx`
- `void result.catch(...)` は利用者に何も届けない。いま実害が無いのは、唯一の非同期の呼び出し側が
  自分で try/catch して `closeFailed` を立てているからで、部品側の catch は効いていない。
- 次の呼び出し側が部品側の握りを頼りにすると、**押しても何も起きないボタン**が戻る。
  しかも `run` が rejection を飲むので、呼び出し側が後から気づく手段も無い。

### [MEDIUM] r4-14 `shared/ui` の汎用部品が、`pages` 層のレイアウトの段の高さから自分の位置を決めている

reviewer: architecture

- 場所: `src/shared/ui/AppErrorBoundary.scss`、`src/index.scss`
- r3-14 は「`shared/ui` の汎用部品が『アプリ側にいま何枚置かれているか』を知っているのは
  レイヤ的に逆向き」として枚数の写しを落とした。**その同じラウンドの `dd8e52c5` が、
  より強い形の同じ結合を入れている** —— 箱の位置が `.app-layout`（pages）の1段目の高さと、
  `AppLayoutHeader`（widgets）のアイコンの並びを前提にしている。
- 逆向きに、`.app-layout` の段構成を変えた人は `shared/ui` の SCSS を直す必要があることに気づけない。

### [MEDIUM] r4-15 同じ prop の doc が3ファイル10箇所に手書きで写されている

reviewer: architecture

- 場所: `AppErrorBoundary` の `Props` / `AppErrorFallbackBody` の引数 / `RootErrorFallback` の `Props`
- `label` / `hint` / `floating` / `error` / `reset` の5概念が3箇所に別々の日本語で置かれている。
  **仮定ではなく既に起きていて、r4-03 と r4-05 はどちらもこの写しの片側だけが動いた形。**

### [MEDIUM] r4-16 モーダル層を壊す条件が、その条件を破れる唯一のファイル以外の3箇所に書かれている

reviewer: architecture

- 場所: 条件の本文は `src/pages/AppLayout.tsx`、写しは `AppErrorBoundary.scss` と `AppModalLayer.test.tsx`、
  破れる場所は `src/pages/AppModalLayer.tsx` の `ModalLayerContent`
- 10枚目のモーダルを足す人が編集するのは `ModalLayerContent` で、そこにあるのは
  行き先を書いていない「置く側が持つ」の一行だけ。
- 条件を破っても、`.app-layout` の段が実際に食われるかを見ているテストは1本も無い。

### [MEDIUM] r4-17 `system-dialogs.md` に、9枚を1枚の境界が畳むことが書かれていない

reviewer: robustness

- 場所: `docs/spec/screens/system-dialogs.md`
- 3つのペインの仕様書には「畳まれるのは〜だけ」が入ったのに、**いちばん粒度の粗い境界
  （1枚の事故で9枚が消える）を持つ画面の仕様書にだけ無い。**
- r4-07 の症状（歯車を押しても設定が出ない）に当たったとき、既知の穴か新しい不具合か判別できない。

### [MEDIUM] r4-18 ADR-0003 の「補間そのものは7箇所」を、隣の行を実測で更新した同じ PR が嘘にした

reviewer: oss-hygiene

- 場所: `docs/decisions/0003-scss-scale-tokens.md`
- 実測は **11行・17箇所**（`origin/main` は 8行・10箇所）。狂わせたのはこの PR 自身
  （`AppErrorBoundary.scss` の6箇所と `AppLayout.scss` の1箇所）。
- 直前の行（35箇所・22ファイル）は測り直して測定日まで添えたのに、同じ箇条書きの次の行は測り直していない。

### [MEDIUM] r4-19 通知の層（`NotificationLayer`）に境界が無い。失敗を出すための層が落ちると窓の中身が丸ごと差し替わる

reviewer: robustness

- 場所: `src/app/providers/BootstrapProviders.tsx`
- `NotificationLayer` は root の境界の直下・`RuntimeShell` の境界より外に居るので、そこで落ちると
  `TitleBar` を含む窓の中身ぜんぶが `RootErrorFallback` に差し替わる。
- **失敗を伝えるための層が、いちばん広い畳み方をする。** しかも `RootErrorFallback` は通知を使えないと
  明記されているので、この経路の失敗だけは通知の土台に載せ替えても届かない。

### [MEDIUM] r4-20 リポジトリ入口の宿題5件（**#436 の範囲外**）

reviewer: oss-hygiene

- **issue #511 の本文の表が `c113ef4c` の後の鍵と食い違う**（r3-23 で #514 だけ直した）
- **ADR-0007 が指す `src-tauri/src/settings/presets.rs` が存在しない**（crate 分割で移動済み）。
  パスの実在検査は `docs/state-transitions/` にしか掛かっていない
- **公開の画面仕様2本が、追跡外（`.gitignore` 済み）の `.claude/plans/` を設計の出典として指している**
- **バグ報告テンプレートが必須にしている「ObsShogi のバージョン」を、アプリのどこにも表示していない**
  （`getVersion()` を呼ぶ経路が0件）
- **`docs/spec/` が README からも CONTRIBUTING からも PR テンプレートからも1度も参照されていない。**
  README の画像3枚も 2026-02-27 のままで、ヘッダ右の「課題局面」が写っていない

## 重複・矛盾した所見

- **`--floating` の束**: r4-01 / r4-02 / r4-09 / r4-10 / r4-14。位置を3回動かしても所見が出続けている根は
  **「1枚しか出ない前提の枠」を2枚が共有していること**と、**閉じる手段が無いこと**。
  ui と architecture が独立に**同じ直し方**（縦積みの入れ物、または呼び出し側から縦位置を渡す）を出している。
- **契約と写しの束**: r4-03 / r4-05 / r4-08 / r4-15 / r4-16。5件とも「同じことを2箇所以上に手書きし、
  片方だけが動いた」形。
- **所在の束**: r4-04 / r4-17。境界を移したのに、それを指す doc を移していない。
- **矛盾**: comment は r4-05 を BLOCK、architecture と react は MEDIUM と判定した。
  ここでは HIGH に置く（実装は正しく、読み手を誤らせるだけなので）。

## 対象そのものを疑ったか

**件数の推移: r1 31 / r2 31 / r3 25 / r4 20。今回初めて明確に落ちた。**

**20件のうち、r3 の修正そのものが作ったのは r4-03 / r4-04 / r4-05 / r4-09 / r4-10 / r4-11 / r4-12 の7件。**
ただし r1〜r3 と**性質が違う**。r3 までは「直し方が別の欠陥を呼ぶ」（位置を動かす → 別のものを覆う）
だったのに対し、今回の7件は**1ラウンド内の修正の順序**が原因になっている ——

- r4-05: 順1 が `actions` / `notice` で doc を書き、順8 が改名した
- r4-03: 順1 が `fallback` の引数を増やしたが、唯一の消費者を直さなかった
- r4-04: 順4 がコードを移したが、それを指す doc とコメントを移さなかった

architecture の判定: **対象（`AppErrorBoundary` を1ファイルに置く形）を替える根拠は今回も無い。**
器と見た目を割っても r4-01〜r4-20 は1件も消えない（割った先でも `RootErrorFallback` は `floating` を落とすし、
doc の写しは3ファイルのまま）。

**替えるべきは計画の順序。** 次の3つを規則にする。

1. **識別子の改名は、その識別子を説明する doc より必ず前に置く**
2. **コードを移す修正は、その識別子を指す全参照の grep を同じコミットに含める**
3. **契約を doc に書く修正は、その契約の既存の実装を同じコミットで直す**

r4-03 / r4-04 / r4-05 はいずれも **grep 1回で落ちる形**の欠陥。

## 見ていない範囲

- **実プロセスで2枚を同時に落として見ていない。** r4-01 の重なりは SCSS の宣言と DOM 順からの算術。
- 通知の帯と `--floating` の重なりは座標を出したが、**帯を通る失敗は現時点で1件も無い**ので
  再現できる筋道が書けない（`failure-surfacing.md` §0）。
- `KifuReadErrorDialog` / `FileConflictDialog` が実際に throw する入力は特定していない。
- README の画像は「ヘッダ右のアイコンの数」しか突き合わせていない。
- `npm run verify` の全体を走らせた reviewer は居ない（`npx tsc -b` と対象テストのみ）。

## lint / hook で強制できるもの

- **`fallback` の引数の型を、それを受ける component の `Props` が包含していること**（r4-03）。
  引数の型に名前を付け、`RootErrorFallback` の `Props` をそこから導出すれば tsc が止める。
  **JSX スプレッドは余剰プロパティを検査しないので、いまの書き方では止まらない**（r3 の記述は誤り）。
- **doc / コメント中の `` `識別子` `` が、そのファイルに実在すること**（r4-05）。
  Rust 側に `comment_identifiers` の同型が既にある。
- **`app-layout.md` の境界表の「場所」列に書かれたファイルに、実際に `<AppErrorBoundary` が在ること**（r4-04）。
  行数の一致（r3-14 / r3-18 で既出）に1条件足すだけ。
- **`hint` の文字列に現れる `「…」` の綴りが、ボタンの文言と一致すること**（r4-08）。定数化すれば型で。
- **`--floating` を付けた `<AppErrorBoundary` の出現数**（r4-01）。2枚目で座標の取り合いが起きる。
- **`position: fixed` かつ `right`/`bottom`/`top` が同値の規則が2つ以上無いこと**（r4-01）。
- **テストのモジュールスコープの可変 stub が `beforeEach`/`afterEach` でリセットされること**（r4-12）。
- **`docs/` が `.gitignore` 済みのパスを指していないこと**、**`docsSourcePaths` を `docs/spec/` と
  `docs/decisions/` へ広げること**（r4-20）。

## 修正計画（r4 → r5）

### 順序の規則（この計画から適用）

対象そのものの節に書いた3つ。**特に「改名は doc より前」「移動は grep を同じコミットに」。**

### このラウンドで直すもの

| 順  | 所見                                  | なぜこの順か                                                                 | この直し方で壊しうるもの                                                                                                       |
| --- | ------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | r4-01 + r4-02 + r4-09 + r4-10 + r4-14 | `--floating` の束。**枠の持ち方そのものを替える**（4回目の位置調整をしない） | 縦積みの入れ物を作ると、2枚が同時に出たときの順序が DOM 順で決まる。`/` でヘッダぶんを空けなくなるので、そちらの見え方が変わる |
| 2   | r4-03 + r4-15                         | 契約を型で持たせる。**唯一の実装を同じコミットで直す**                       | 引数の型に名前を付けると、`RootErrorFallback` の `Props` がそこから導出される。引数を足すたびに落ちるようになる（意図どおり）  |
| 3   | r4-05                                 | **改名の doc 側。順2 で口が確定してから**                                    | 無し                                                                                                                           |
| 4   | r4-08                                 | 綴りを1つにする                                                              | 定数を `shared/ui` に置くので、`hint` を書く側が import する                                                                   |
| 5   | r4-06                                 | 案内が指す操作が実在しない                                                   | 盤と棋譜一覧の `hint` が同じ文になる                                                                                           |
| 6   | r4-07                                 | 案内が往復を作る。**出口を置く**                                             | `AppModalLayer` が `fallback` を渡す2枚目になるので、順2 の契約が効くか確かめる                                                |
| 7   | r4-13                                 | 型と doc の食い違い                                                          | 無し                                                                                                                           |
| 8   | r4-11 + r4-12                         | テスト                                                                       | `stub.conflict` を `beforeEach` で戻すと、既存3本の前提が変わる                                                                |
| 9   | r4-04 + r4-16 + r4-17                 | 所在の束。**grep を同じコミットに含める**                                    | 無し                                                                                                                           |
| 10  | r4-18                                 | 実測                                                                         | 数は次に `#{}` を1つ足した瞬間に腐る。数え方を明示する                                                                         |

### 直さないもの

| 所見  | 行き先                     | 理由                                                                                    |
| ----- | -------------------------- | --------------------------------------------------------------------------------------- |
| r4-19 | **既存の #512 へコメント** | 境界を1枚足す判断。#512（ヘッダとサイドバー）と同じ「粒度を変えるか」の判断に属する     |
| r4-20 | **既存の #522 / #511 へ**  | リポジトリ入口の5件。#436 の範囲の外で、どれも `main` から在る（#511 の本文だけは直す） |

### 次ラウンドの焦点

1. **`--floating` の枠の持ち方を替えたこと（4回目）。** 2枚が同時に出たときに両方読めるか。
   `/` と `/app` の両方で位置が成立しているか
2. **`fallback` の引数を型で縛ったこと。** `RootErrorFallback` が落としている prop が無いか、
   2枚目の `fallback`（モーダル層）が契約を守れているか
3. **`RETRY_LABEL` を定数にしたこと。** import の向き（`pages`/`app` → `shared`）と、
   文言を組む側の読みやすさ
4. **モーダル層に出口（`extraActions`）を置いたこと。** `AppModalLayer` が境界の外で
   `clearKifuError` を握る形が、新しい結合になっていないか
5. **今回の修正で、また doc / コメントの写しが片側だけ動いていないか。**
   **順序の規則3つが守られているかを、コミットの粒度で確かめてほしい**
6. **件数が20 → いくつになったか。** 3ラウンド続けて減らなければ対象を疑う、は r4 で
   「替えるべきは順序」と結論した。その結論が正しかったかを件数で見る

### 検証の見積り

10束 ×（束の中は1所見1コミット）で概ね18コミット。TS のみの `verify`（実測 40〜60 秒）で 15〜25 分。
